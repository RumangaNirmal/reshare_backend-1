import { getAuth } from 'firebase-admin/auth';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { distanceBetween, geohashForLocation, geohashQueryBounds } from 'geofire-common';
import { z } from 'zod';
import { db, data, id, itemInput, location, notify, parse, region, requestInput, requireAdmin, requireUser, serverTimestamp } from './common.js';

const profileInput = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().email().optional(),
  phone: z.string().regex(/^\+94[0-9]{9}$/).optional(),
  preferredLanguage: z.enum(['en', 'si', 'ta']).default('en'),
  location: location.optional(),
});
const listInput = z.object({ category: z.string().optional(), status: z.string().default('available'), limit: z.number().int().min(1).max(50).default(25) });

export const createUserProfile = onCall({ region }, async (request) => {
  const uid = requireUser(request);
  const input = parse(profileInput, request.data);
  const ref = db.doc(`users/${uid}`);
  const existing = await ref.get();
  if (existing.exists) return data(existing);
  const profile = { id: uid, fullName: input.fullName, email: input.email ?? request.auth?.token.email ?? '', phone: input.phone ?? request.auth?.token.phone_number ?? '', avatarUrl: '', preferredLanguage: input.preferredLanguage, location: input.location ?? null, verification: { phoneVerified: false, emailVerified: false, studentIdVerified: false, nationalIdVerified: false, ngoVerified: false }, impactStats: { itemsShared: 0, itemsClaimed: 0, requestsCreated: 0, requestsFulfilled: 0, co2SavedKg: 0, badges: [] }, role: 'user', createdAt: serverTimestamp, updatedAt: serverTimestamp };
  await ref.set(profile);
  return profile;
});

export const sendPhoneOtp = onCall({ region }, async (request) => {
  requireUser(request);
  const phone = parse(z.string().regex(/^\+94[0-9]{9}$/), request.data?.phone);
  return { phone, provider: 'firebase-phone-auth', clientAction: 'verifyPhoneNumber' };
});
export const verifyPhoneOtp = onCall({ region }, async (request) => {
  const uid = requireUser(request);
  if (!request.auth?.token.phone_number) throw new HttpsError('failed-precondition', 'Complete Firebase Phone Auth on the client before calling this function.');
  await db.doc(`users/${uid}`).set({ phone: request.auth.token.phone_number, 'verification.phoneVerified': true, updatedAt: serverTimestamp }, { merge: true });
  return { verified: true, phone: request.auth.token.phone_number };
});

export const updateProfile = onCall({ region }, async (request) => { const uid = requireUser(request); const input = parse(profileInput.partial(), request.data); await db.doc(`users/${uid}`).set({ ...input, updatedAt: serverTimestamp }, { merge: true }); return data(await db.doc(`users/${uid}`).get()); });
export const getCurrentUser = onCall({ region }, async (request) => data(await db.doc(`users/${requireUser(request)}`).get()));
export const deleteUser = onCall({ region }, async (request) => { const uid = requireUser(request); await db.doc(`users/${uid}`).delete(); await getAuth().deleteUser(uid); return { success: true }; });
export const uploadAvatar = onCall({ region }, async (request) => { const uid = requireUser(request); const avatarUrl = parse(z.string().url(), request.data?.avatarUrl); await db.doc(`users/${uid}`).set({ avatarUrl, updatedAt: serverTimestamp }, { merge: true }); return { avatarUrl }; });

export const createItem = onCall({ region }, async (request) => { const ownerId = requireUser(request); const input = parse(itemInput, request.data); const ref = db.collection('items').doc(); await ref.set({ id: ref.id, ownerId, ...input, geohash: geohashForLocation([input.location.lat, input.location.lng]), status: 'available', claimsCount: 0, createdAt: serverTimestamp, updatedAt: serverTimestamp }); return data(await ref.get()); });
export const updateItem = onCall({ region }, async (request) => { const uid = requireUser(request); const itemId = parse(id, request.data?.itemId); const input = parse(itemInput.partial(), request.data); const ref = db.doc(`items/${itemId}`); const snap = await ref.get(); if (!snap.exists || snap.data()?.ownerId !== uid) throw new HttpsError('permission-denied', 'Only the owner can edit this item.'); await ref.update({ ...input, ...(input.location ? { geohash: geohashForLocation([input.location.lat, input.location.lng]) } : {}), updatedAt: serverTimestamp }); return data(await ref.get()); });
export const deleteItem = onCall({ region }, async (request) => { const uid = requireUser(request); const itemId = parse(id, request.data?.itemId); const ref = db.doc(`items/${itemId}`); const snap = await ref.get(); if (!snap.exists || snap.data()?.ownerId !== uid) throw new HttpsError('permission-denied', 'Only the owner can remove this item.'); await ref.update({ status: 'expired', updatedAt: serverTimestamp }); return { success: true }; });
export const getItem = onCall({ region }, async (request) => data(await db.doc(`items/${parse(id, request.data?.itemId)}`).get()));
export const getMyItems = onCall({ region }, async (request) => { const snap = await db.collection('items').where('ownerId', '==', requireUser(request)).orderBy('createdAt', 'desc').limit(50).get(); return snap.docs.map((doc) => data(doc)); });
export const searchItems = onCall({ region }, async (request) => { requireUser(request); const input = parse(listInput, request.data ?? {}); let query: FirebaseFirestore.Query = db.collection('items').where('status', '==', input.status); if (input.category) query = query.where('category', '==', input.category); const snap = await query.orderBy('createdAt', 'desc').limit(input.limit ?? 25).get(); return snap.docs.map((doc) => data(doc)); });
export const getNearbyItems = onCall({ region }, async (request) => {
  requireUser(request);
  const input = parse(z.object({ lat: z.number().gte(-90).lte(90), lng: z.number().gte(-180).lte(180), radiusKm: z.union([z.literal(2), z.literal(5), z.literal(10), z.literal(25)]), category: z.string().optional(), limit: z.number().int().min(1).max(50).default(50) }), request.data);
  const center: [number, number] = [input.lat, input.lng];
  const bounds = geohashQueryBounds(center, input.radiusKm * 1000);
  const snapshots = await Promise.all(bounds.map(([start, end]) => db.collection('items').where('status', '==', 'available').orderBy('geohash').startAt(start).endAt(end).limit(input.limit ?? 50).get()));
  const items = snapshots.flatMap((snapshot) => snapshot.docs).map((doc) => ({ snapshot: doc, distanceKm: distanceBetween(center, [doc.data().location.lat, doc.data().location.lng]) })).filter(({ distanceKm }) => distanceKm <= input.radiusKm).filter(({ snapshot }) => !input.category || snapshot.data().category === input.category).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, input.limit);
  return items.map(({ snapshot, distanceKm }) => ({ ...data(snapshot), distanceKm }));
});

export const claimItem = onCall({ region }, async (request) => {
  const claimantId = requireUser(request);
  const itemId = parse(id, request.data?.itemId);
  const itemRef = db.doc(`items/${itemId}`);
  const itemSnap = await itemRef.get();
  if (!itemSnap.exists || itemSnap.data()?.status !== 'available') throw new HttpsError('failed-precondition', 'Item is not available.');
  if (itemSnap.data()?.ownerId === claimantId) throw new HttpsError('invalid-argument', 'Owners cannot claim their own item.');
  const ref = db.collection('claims').doc();
  await db.runTransaction(async (transaction) => { transaction.set(ref, { id: ref.id, itemId, donorId: itemSnap.data()?.ownerId, claimantId, status: 'pending', createdAt: serverTimestamp, updatedAt: serverTimestamp }); transaction.update(itemRef, { claimsCount: (itemSnap.data()?.claimsCount ?? 0) + 1, updatedAt: serverTimestamp }); });
  await notify(itemSnap.data()?.ownerId as string, 'New claim', 'Someone wants your shared item.', 'claim');
  return data(await ref.get());
});

async function decideClaim(request: Parameters<typeof requireUser>[0], status: 'accepted' | 'rejected') {
  const donorId = requireUser(request);
  const claimId = parse(id, request.data?.claimId);
  const ref = db.doc(`claims/${claimId}`);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.donorId !== donorId) throw new HttpsError('permission-denied', 'Only the donor can decide this claim.');
  await ref.update({ status, updatedAt: serverTimestamp });
  if (status === 'accepted') await db.doc(`items/${snap.data()?.itemId}`).update({ status: 'claimed', updatedAt: serverTimestamp });
  await notify(snap.data()?.claimantId as string, `Claim ${status}`, `Your claim was ${status}.`, 'claim');
  return data(await ref.get());
}
export const acceptClaim = onCall({ region }, (request) => decideClaim(request, 'accepted'));
export const rejectClaim = onCall({ region }, (request) => decideClaim(request, 'rejected'));
export const completeClaim = onCall({ region }, async (request) => { const uid = requireUser(request); const claimId = parse(id, request.data?.claimId); const ref = db.doc(`claims/${claimId}`); const snap = await ref.get(); if (!snap.exists || ![snap.data()?.donorId, snap.data()?.claimantId].includes(uid)) throw new HttpsError('permission-denied', 'Only claim participants can complete it.'); await ref.update({ status: 'completed', updatedAt: serverTimestamp }); await db.doc(`items/${snap.data()?.itemId}`).update({ status: 'completed', updatedAt: serverTimestamp }); return { success: true }; });

export const createRequest = onCall({ region }, async (request) => { const requesterId = requireUser(request); const input = parse(requestInput, request.data); const ref = db.collection('requests').doc(); await ref.set({ id: ref.id, requesterId, ...input, status: 'open', createdAt: serverTimestamp, updatedAt: serverTimestamp }); return data(await ref.get()); });
export const updateRequest = onCall({ region }, async (request) => { const uid = requireUser(request); const requestId = parse(id, request.data?.requestId); const input = parse(requestInput.partial(), request.data); const ref = db.doc(`requests/${requestId}`); const snap = await ref.get(); if (!snap.exists || snap.data()?.requesterId !== uid) throw new HttpsError('permission-denied', 'Only the requester can edit it.'); await ref.update({ ...input, updatedAt: serverTimestamp }); return data(await ref.get()); });
export const closeRequest = onCall({ region }, async (request) => { const uid = requireUser(request); const requestId = parse(id, request.data?.requestId); const ref = db.doc(`requests/${requestId}`); const snap = await ref.get(); if (!snap.exists || snap.data()?.requesterId !== uid) throw new HttpsError('permission-denied', 'Only the requester can close it.'); await ref.update({ status: 'closed', updatedAt: serverTimestamp }); return { success: true }; });
export const fulfillRequest = onCall({ region }, async (request) => { const uid = requireUser(request); const requestId = parse(id, request.data?.requestId); const ref = db.doc(`requests/${requestId}`); const snap = await ref.get(); if (!snap.exists || snap.data()?.status !== 'open') throw new HttpsError('failed-precondition', 'Request is not open.'); await ref.update({ status: 'fulfilled', fulfilledBy: uid, updatedAt: serverTimestamp }); await notify(snap.data()?.requesterId as string, 'Request fulfilled', 'Your community request has been fulfilled.', 'request'); return data(await ref.get()); });
export const uploadVerificationDocuments = onCall({ region }, async (request) => { const userId = requireUser(request); const input = parse(z.object({ type: z.enum(['student', 'ngo', 'nationalId']), documents: z.array(z.string().url()).min(1).max(3) }), request.data); const ref = db.collection('verifications').doc(); await ref.set({ id: ref.id, userId, type: input.type, documents: input.documents, status: 'pending', createdAt: serverTimestamp, updatedAt: serverTimestamp }); return data(await ref.get()); });

export const saveFcmToken = onCall({ region }, async (request) => { const uid = requireUser(request); const token = parse(z.string().min(20).max(4096), request.data?.token); await db.doc(`users/${uid}/fcmTokens/${token}`).set({ createdAt: serverTimestamp, platform: request.data?.platform ?? 'unknown' }); return { success: true }; });
export const markNotificationRead = onCall({ region }, async (request) => { const uid = requireUser(request); const notificationId = parse(id, request.data?.notificationId); await db.doc(`users/${uid}/notifications/${notificationId}`).update({ read: true }); return { success: true }; });
export const markAllNotificationsRead = onCall({ region }, async (request) => { const uid = requireUser(request); const snap = await db.collection(`users/${uid}/notifications`).where('read', '==', false).get(); const batch = db.batch(); snap.docs.forEach((doc) => batch.update(doc.ref, { read: true })); await batch.commit(); return { count: snap.size }; });
export const sendNotification = onCall({ region }, async (request) => { requireAdmin(request); const input = parse(z.object({ userId: id, title: z.string().min(1).max(100), body: z.string().min(1).max(500), type: z.enum(['claim', 'item', 'request', 'verification', 'impact']) }), request.data); await notify(input.userId, input.title, input.body, input.type); return { success: true }; });

export const approveVerification = onCall({ region }, (request) => reviewVerification(request, 'approved'));
export const rejectVerification = onCall({ region }, (request) => reviewVerification(request, 'rejected'));
async function reviewVerification(request: Parameters<typeof requireAdmin>[0], status: 'approved' | 'rejected') { requireAdmin(request); const verificationId = parse(id, request.data?.verificationId); const ref = db.doc(`verifications/${verificationId}`); const snap = await ref.get(); if (!snap.exists) throw new HttpsError('not-found', 'Verification was not found.'); await ref.update({ status, reviewedAt: serverTimestamp, updatedAt: serverTimestamp }); return data(await ref.get()); }
export const calculateImpact = onCall({ region }, async (request) => { const uid = requireUser(request); const ref = db.doc(`impactMetrics/${uid}`); const metric = (await ref.get()).data() ?? {}; const co2SavedKg = Number(metric.itemsReceived ?? 0) * Number(process.env.CO2_KG_PER_ITEM ?? 2.5); await ref.set({ ...metric, userId: uid, co2SavedKg, updatedAt: serverTimestamp }, { merge: true }); return data(await ref.get()); });
export const assignBadges = onCall({ region }, async (request) => { const uid = requireUser(request); const ref = db.doc(`impactMetrics/${uid}`); const metric = (await ref.get()).data() ?? {}; const total = Number(metric.itemsReceived ?? 0) + Number(metric.itemsShared ?? 0); const badges = [total >= 1 && 'Seed Planter', total >= 5 && 'Community Helper', total >= 15 && 'Green Hero', total >= 30 && 'Eco Warrior', total >= 100 && 'Impact Leader'].filter((badge): badge is string => Boolean(badge)); await ref.set({ badges, updatedAt: serverTimestamp }, { merge: true }); return { badges }; });

export const onUserCreated = onDocumentCreated({ document: 'users/{userId}', region }, async (event) => { const userId = event.params.userId; await db.doc(`impactMetrics/${userId}`).set({ userId, itemsShared: 0, itemsReceived: 0, requestsFulfilled: 0, co2SavedKg: 0, badges: [], updatedAt: serverTimestamp }, { merge: true }); });
export const onClaimUpdated = onDocumentUpdated({ document: 'claims/{claimId}', region }, async (event) => { const before = event.data?.before.data(); const after = event.data?.after.data(); if (!before || !after || before.status === after.status || after.status !== 'completed') return; const metric = db.doc(`impactMetrics/${after.claimantId}`); const current = (await metric.get()).data() ?? {}; await metric.set({ itemsReceived: (current.itemsReceived ?? 0) + 1, co2SavedKg: (current.co2SavedKg ?? 0) + Number(process.env.CO2_KG_PER_ITEM ?? 2.5), updatedAt: serverTimestamp }, { merge: true }); });
export const cleanupExpiredItems = onSchedule({ schedule: 'every 24 hours', region }, async () => { const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); const snap = await db.collection('items').where('status', '==', 'available').where('updatedAt', '<', cutoff).limit(500).get(); const batch = db.batch(); snap.docs.forEach((doc) => batch.update(doc.ref, { status: 'expired', updatedAt: serverTimestamp })); await batch.commit(); });
export const dailyAnalyticsJob = onSchedule({ schedule: 'every 24 hours', region }, async () => { const [users, items, requests] = await Promise.all([db.collection('users').count().get(), db.collection('items').count().get(), db.collection('requests').count().get()]); await db.doc('analytics/daily').set({ users: users.data().count, items: items.data().count, requests: requests.data().count, generatedAt: serverTimestamp }, { merge: true }); });