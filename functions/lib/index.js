"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailyAnalyticsJob = exports.cleanupExpiredItems = exports.onClaimUpdated = exports.onUserCreated = exports.assignBadges = exports.calculateImpact = exports.rejectVerification = exports.approveVerification = exports.sendNotification = exports.markAllNotificationsRead = exports.markNotificationRead = exports.saveFcmToken = exports.uploadVerificationDocuments = exports.fulfillRequest = exports.closeRequest = exports.updateRequest = exports.createRequest = exports.completeClaim = exports.rejectClaim = exports.acceptClaim = exports.claimItem = exports.getNearbyItems = exports.searchItems = exports.getMyItems = exports.getItem = exports.deleteItem = exports.updateItem = exports.createItem = exports.uploadAvatar = exports.deleteUser = exports.getCurrentUser = exports.updateProfile = exports.verifyPhoneOtp = exports.sendPhoneOtp = exports.createUserProfile = void 0;
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const geofire_common_1 = require("geofire-common");
const zod_1 = require("zod");
const common_js_1 = require("./common.js");
const profileInput = zod_1.z.object({
    fullName: zod_1.z.string().trim().min(2).max(120),
    email: zod_1.z.string().email().optional(),
    phone: zod_1.z.string().regex(/^\+94[0-9]{9}$/).optional(),
    preferredLanguage: zod_1.z.enum(['en', 'si', 'ta']).default('en'),
    location: common_js_1.location.optional(),
});
const listInput = zod_1.z.object({ category: zod_1.z.string().optional(), status: zod_1.z.string().default('available'), limit: zod_1.z.number().int().min(1).max(50).default(25) });
exports.createUserProfile = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => {
    const uid = (0, common_js_1.requireUser)(request);
    const input = (0, common_js_1.parse)(profileInput, request.data);
    const ref = common_js_1.db.doc(`users/${uid}`);
    const existing = await ref.get();
    if (existing.exists)
        return (0, common_js_1.data)(existing);
    const profile = { id: uid, fullName: input.fullName, email: input.email ?? request.auth?.token.email ?? '', phone: input.phone ?? request.auth?.token.phone_number ?? '', avatarUrl: '', preferredLanguage: input.preferredLanguage, location: input.location ?? null, verification: { phoneVerified: false, emailVerified: false, studentIdVerified: false, nationalIdVerified: false, ngoVerified: false }, impactStats: { itemsShared: 0, itemsClaimed: 0, requestsCreated: 0, requestsFulfilled: 0, co2SavedKg: 0, badges: [] }, role: 'user', createdAt: common_js_1.serverTimestamp, updatedAt: common_js_1.serverTimestamp };
    await ref.set(profile);
    return profile;
});
exports.sendPhoneOtp = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => {
    (0, common_js_1.requireUser)(request);
    const phone = (0, common_js_1.parse)(zod_1.z.string().regex(/^\+94[0-9]{9}$/), request.data?.phone);
    return { phone, provider: 'firebase-phone-auth', clientAction: 'verifyPhoneNumber' };
});
exports.verifyPhoneOtp = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => {
    const uid = (0, common_js_1.requireUser)(request);
    if (!request.auth?.token.phone_number)
        throw new https_1.HttpsError('failed-precondition', 'Complete Firebase Phone Auth on the client before calling this function.');
    await common_js_1.db.doc(`users/${uid}`).set({ phone: request.auth.token.phone_number, 'verification.phoneVerified': true, updatedAt: common_js_1.serverTimestamp }, { merge: true });
    return { verified: true, phone: request.auth.token.phone_number };
});
exports.updateProfile = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => { const uid = (0, common_js_1.requireUser)(request); const input = (0, common_js_1.parse)(profileInput.partial(), request.data); await common_js_1.db.doc(`users/${uid}`).set({ ...input, updatedAt: common_js_1.serverTimestamp }, { merge: true }); return (0, common_js_1.data)(await common_js_1.db.doc(`users/${uid}`).get()); });
exports.getCurrentUser = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => (0, common_js_1.data)(await common_js_1.db.doc(`users/${(0, common_js_1.requireUser)(request)}`).get()));
exports.deleteUser = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => { const uid = (0, common_js_1.requireUser)(request); await common_js_1.db.doc(`users/${uid}`).delete(); await (0, auth_1.getAuth)().deleteUser(uid); return { success: true }; });
exports.uploadAvatar = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => { const uid = (0, common_js_1.requireUser)(request); const avatarUrl = (0, common_js_1.parse)(zod_1.z.string().url(), request.data?.avatarUrl); await common_js_1.db.doc(`users/${uid}`).set({ avatarUrl, updatedAt: common_js_1.serverTimestamp }, { merge: true }); return { avatarUrl }; });
exports.createItem = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => { const ownerId = (0, common_js_1.requireUser)(request); const input = (0, common_js_1.parse)(common_js_1.itemInput, request.data); const ref = common_js_1.db.collection('items').doc(); await ref.set({ id: ref.id, ownerId, ...input, geohash: (0, geofire_common_1.geohashForLocation)([input.location.lat, input.location.lng]), status: 'available', claimsCount: 0, createdAt: common_js_1.serverTimestamp, updatedAt: common_js_1.serverTimestamp }); return (0, common_js_1.data)(await ref.get()); });
exports.updateItem = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => { const uid = (0, common_js_1.requireUser)(request); const itemId = (0, common_js_1.parse)(common_js_1.id, request.data?.itemId); const input = (0, common_js_1.parse)(common_js_1.itemInput.partial(), request.data); const ref = common_js_1.db.doc(`items/${itemId}`); const snap = await ref.get(); if (!snap.exists || snap.data()?.ownerId !== uid)
    throw new https_1.HttpsError('permission-denied', 'Only the owner can edit this item.'); await ref.update({ ...input, ...(input.location ? { geohash: (0, geofire_common_1.geohashForLocation)([input.location.lat, input.location.lng]) } : {}), updatedAt: common_js_1.serverTimestamp }); return (0, common_js_1.data)(await ref.get()); });
exports.deleteItem = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => { const uid = (0, common_js_1.requireUser)(request); const itemId = (0, common_js_1.parse)(common_js_1.id, request.data?.itemId); const ref = common_js_1.db.doc(`items/${itemId}`); const snap = await ref.get(); if (!snap.exists || snap.data()?.ownerId !== uid)
    throw new https_1.HttpsError('permission-denied', 'Only the owner can remove this item.'); await ref.update({ status: 'expired', updatedAt: common_js_1.serverTimestamp }); return { success: true }; });
exports.getItem = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => (0, common_js_1.data)(await common_js_1.db.doc(`items/${(0, common_js_1.parse)(common_js_1.id, request.data?.itemId)}`).get()));
exports.getMyItems = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => { const snap = await common_js_1.db.collection('items').where('ownerId', '==', (0, common_js_1.requireUser)(request)).orderBy('createdAt', 'desc').limit(50).get(); return snap.docs.map((doc) => (0, common_js_1.data)(doc)); });
exports.searchItems = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => { (0, common_js_1.requireUser)(request); const input = (0, common_js_1.parse)(listInput, request.data ?? {}); let query = common_js_1.db.collection('items').where('status', '==', input.status); if (input.category)
    query = query.where('category', '==', input.category); const snap = await query.orderBy('createdAt', 'desc').limit(input.limit ?? 25).get(); return snap.docs.map((doc) => (0, common_js_1.data)(doc)); });
exports.getNearbyItems = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => {
    (0, common_js_1.requireUser)(request);
    const input = (0, common_js_1.parse)(zod_1.z.object({ lat: zod_1.z.number().gte(-90).lte(90), lng: zod_1.z.number().gte(-180).lte(180), radiusKm: zod_1.z.union([zod_1.z.literal(2), zod_1.z.literal(5), zod_1.z.literal(10), zod_1.z.literal(25)]), category: zod_1.z.string().optional(), limit: zod_1.z.number().int().min(1).max(50).default(50) }), request.data);
    const center = [input.lat, input.lng];
    const bounds = (0, geofire_common_1.geohashQueryBounds)(center, input.radiusKm * 1000);
    const snapshots = await Promise.all(bounds.map(([start, end]) => common_js_1.db.collection('items').where('status', '==', 'available').orderBy('geohash').startAt(start).endAt(end).limit(input.limit ?? 50).get()));
    const items = snapshots.flatMap((snapshot) => snapshot.docs).map((doc) => ({ snapshot: doc, distanceKm: (0, geofire_common_1.distanceBetween)(center, [doc.data().location.lat, doc.data().location.lng]) })).filter(({ distanceKm }) => distanceKm <= input.radiusKm).filter(({ snapshot }) => !input.category || snapshot.data().category === input.category).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, input.limit);
    return items.map(({ snapshot, distanceKm }) => ({ ...(0, common_js_1.data)(snapshot), distanceKm }));
});
exports.claimItem = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => {
    const claimantId = (0, common_js_1.requireUser)(request);
    const itemId = (0, common_js_1.parse)(common_js_1.id, request.data?.itemId);
    const itemRef = common_js_1.db.doc(`items/${itemId}`);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists || itemSnap.data()?.status !== 'available')
        throw new https_1.HttpsError('failed-precondition', 'Item is not available.');
    if (itemSnap.data()?.ownerId === claimantId)
        throw new https_1.HttpsError('invalid-argument', 'Owners cannot claim their own item.');
    const ref = common_js_1.db.collection('claims').doc();
    await common_js_1.db.runTransaction(async (transaction) => { transaction.set(ref, { id: ref.id, itemId, donorId: itemSnap.data()?.ownerId, claimantId, status: 'pending', createdAt: common_js_1.serverTimestamp, updatedAt: common_js_1.serverTimestamp }); transaction.update(itemRef, { claimsCount: (itemSnap.data()?.claimsCount ?? 0) + 1, updatedAt: common_js_1.serverTimestamp }); });
    await (0, common_js_1.notify)(itemSnap.data()?.ownerId, 'New claim', 'Someone wants your shared item.', 'claim');
    return (0, common_js_1.data)(await ref.get());
});
async function decideClaim(request, status) {
    const donorId = (0, common_js_1.requireUser)(request);
    const claimId = (0, common_js_1.parse)(common_js_1.id, request.data?.claimId);
    const ref = common_js_1.db.doc(`claims/${claimId}`);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.donorId !== donorId)
        throw new https_1.HttpsError('permission-denied', 'Only the donor can decide this claim.');
    await ref.update({ status, updatedAt: common_js_1.serverTimestamp });
    if (status === 'accepted')
        await common_js_1.db.doc(`items/${snap.data()?.itemId}`).update({ status: 'claimed', updatedAt: common_js_1.serverTimestamp });
    await (0, common_js_1.notify)(snap.data()?.claimantId, `Claim ${status}`, `Your claim was ${status}.`, 'claim');
    return (0, common_js_1.data)(await ref.get());
}
exports.acceptClaim = (0, https_1.onCall)({ region: common_js_1.region }, (request) => decideClaim(request, 'accepted'));
exports.rejectClaim = (0, https_1.onCall)({ region: common_js_1.region }, (request) => decideClaim(request, 'rejected'));
exports.completeClaim = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => { const uid = (0, common_js_1.requireUser)(request); const claimId = (0, common_js_1.parse)(common_js_1.id, request.data?.claimId); const ref = common_js_1.db.doc(`claims/${claimId}`); const snap = await ref.get(); if (!snap.exists || ![snap.data()?.donorId, snap.data()?.claimantId].includes(uid))
    throw new https_1.HttpsError('permission-denied', 'Only claim participants can complete it.'); await ref.update({ status: 'completed', updatedAt: common_js_1.serverTimestamp }); await common_js_1.db.doc(`items/${snap.data()?.itemId}`).update({ status: 'completed', updatedAt: common_js_1.serverTimestamp }); return { success: true }; });
exports.createRequest = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => { const requesterId = (0, common_js_1.requireUser)(request); const input = (0, common_js_1.parse)(common_js_1.requestInput, request.data); const ref = common_js_1.db.collection('requests').doc(); await ref.set({ id: ref.id, requesterId, ...input, status: 'open', createdAt: common_js_1.serverTimestamp, updatedAt: common_js_1.serverTimestamp }); return (0, common_js_1.data)(await ref.get()); });
exports.updateRequest = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => { const uid = (0, common_js_1.requireUser)(request); const requestId = (0, common_js_1.parse)(common_js_1.id, request.data?.requestId); const input = (0, common_js_1.parse)(common_js_1.requestInput.partial(), request.data); const ref = common_js_1.db.doc(`requests/${requestId}`); const snap = await ref.get(); if (!snap.exists || snap.data()?.requesterId !== uid)
    throw new https_1.HttpsError('permission-denied', 'Only the requester can edit it.'); await ref.update({ ...input, updatedAt: common_js_1.serverTimestamp }); return (0, common_js_1.data)(await ref.get()); });
exports.closeRequest = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => { const uid = (0, common_js_1.requireUser)(request); const requestId = (0, common_js_1.parse)(common_js_1.id, request.data?.requestId); const ref = common_js_1.db.doc(`requests/${requestId}`); const snap = await ref.get(); if (!snap.exists || snap.data()?.requesterId !== uid)
    throw new https_1.HttpsError('permission-denied', 'Only the requester can close it.'); await ref.update({ status: 'closed', updatedAt: common_js_1.serverTimestamp }); return { success: true }; });
exports.fulfillRequest = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => { const uid = (0, common_js_1.requireUser)(request); const requestId = (0, common_js_1.parse)(common_js_1.id, request.data?.requestId); const ref = common_js_1.db.doc(`requests/${requestId}`); const snap = await ref.get(); if (!snap.exists || snap.data()?.status !== 'open')
    throw new https_1.HttpsError('failed-precondition', 'Request is not open.'); await ref.update({ status: 'fulfilled', fulfilledBy: uid, updatedAt: common_js_1.serverTimestamp }); await (0, common_js_1.notify)(snap.data()?.requesterId, 'Request fulfilled', 'Your community request has been fulfilled.', 'request'); return (0, common_js_1.data)(await ref.get()); });
exports.uploadVerificationDocuments = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => { const userId = (0, common_js_1.requireUser)(request); const input = (0, common_js_1.parse)(zod_1.z.object({ type: zod_1.z.enum(['student', 'ngo', 'nationalId']), documents: zod_1.z.array(zod_1.z.string().url()).min(1).max(3) }), request.data); const ref = common_js_1.db.collection('verifications').doc(); await ref.set({ id: ref.id, userId, type: input.type, documents: input.documents, status: 'pending', createdAt: common_js_1.serverTimestamp, updatedAt: common_js_1.serverTimestamp }); return (0, common_js_1.data)(await ref.get()); });
exports.saveFcmToken = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => { const uid = (0, common_js_1.requireUser)(request); const token = (0, common_js_1.parse)(zod_1.z.string().min(20).max(4096), request.data?.token); await common_js_1.db.doc(`users/${uid}/fcmTokens/${token}`).set({ createdAt: common_js_1.serverTimestamp, platform: request.data?.platform ?? 'unknown' }); return { success: true }; });
exports.markNotificationRead = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => { const uid = (0, common_js_1.requireUser)(request); const notificationId = (0, common_js_1.parse)(common_js_1.id, request.data?.notificationId); await common_js_1.db.doc(`users/${uid}/notifications/${notificationId}`).update({ read: true }); return { success: true }; });
exports.markAllNotificationsRead = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => { const uid = (0, common_js_1.requireUser)(request); const snap = await common_js_1.db.collection(`users/${uid}/notifications`).where('read', '==', false).get(); const batch = common_js_1.db.batch(); snap.docs.forEach((doc) => batch.update(doc.ref, { read: true })); await batch.commit(); return { count: snap.size }; });
exports.sendNotification = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => { (0, common_js_1.requireAdmin)(request); const input = (0, common_js_1.parse)(zod_1.z.object({ userId: common_js_1.id, title: zod_1.z.string().min(1).max(100), body: zod_1.z.string().min(1).max(500), type: zod_1.z.enum(['claim', 'item', 'request', 'verification', 'impact']) }), request.data); await (0, common_js_1.notify)(input.userId, input.title, input.body, input.type); return { success: true }; });
exports.approveVerification = (0, https_1.onCall)({ region: common_js_1.region }, (request) => reviewVerification(request, 'approved'));
exports.rejectVerification = (0, https_1.onCall)({ region: common_js_1.region }, (request) => reviewVerification(request, 'rejected'));
async function reviewVerification(request, status) { (0, common_js_1.requireAdmin)(request); const verificationId = (0, common_js_1.parse)(common_js_1.id, request.data?.verificationId); const ref = common_js_1.db.doc(`verifications/${verificationId}`); const snap = await ref.get(); if (!snap.exists)
    throw new https_1.HttpsError('not-found', 'Verification was not found.'); await ref.update({ status, reviewedAt: common_js_1.serverTimestamp, updatedAt: common_js_1.serverTimestamp }); return (0, common_js_1.data)(await ref.get()); }
exports.calculateImpact = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => { const uid = (0, common_js_1.requireUser)(request); const ref = common_js_1.db.doc(`impactMetrics/${uid}`); const metric = (await ref.get()).data() ?? {}; const co2SavedKg = Number(metric.itemsReceived ?? 0) * Number(process.env.CO2_KG_PER_ITEM ?? 2.5); await ref.set({ ...metric, userId: uid, co2SavedKg, updatedAt: common_js_1.serverTimestamp }, { merge: true }); return (0, common_js_1.data)(await ref.get()); });
exports.assignBadges = (0, https_1.onCall)({ region: common_js_1.region }, async (request) => { const uid = (0, common_js_1.requireUser)(request); const ref = common_js_1.db.doc(`impactMetrics/${uid}`); const metric = (await ref.get()).data() ?? {}; const total = Number(metric.itemsReceived ?? 0) + Number(metric.itemsShared ?? 0); const badges = [total >= 1 && 'Seed Planter', total >= 5 && 'Community Helper', total >= 15 && 'Green Hero', total >= 30 && 'Eco Warrior', total >= 100 && 'Impact Leader'].filter((badge) => Boolean(badge)); await ref.set({ badges, updatedAt: common_js_1.serverTimestamp }, { merge: true }); return { badges }; });
exports.onUserCreated = (0, firestore_1.onDocumentCreated)({ document: 'users/{userId}', region: common_js_1.region }, async (event) => { const userId = event.params.userId; await common_js_1.db.doc(`impactMetrics/${userId}`).set({ userId, itemsShared: 0, itemsReceived: 0, requestsFulfilled: 0, co2SavedKg: 0, badges: [], updatedAt: common_js_1.serverTimestamp }, { merge: true }); });
exports.onClaimUpdated = (0, firestore_1.onDocumentUpdated)({ document: 'claims/{claimId}', region: common_js_1.region }, async (event) => { const before = event.data?.before.data(); const after = event.data?.after.data(); if (!before || !after || before.status === after.status || after.status !== 'completed')
    return; const metric = common_js_1.db.doc(`impactMetrics/${after.claimantId}`); const current = (await metric.get()).data() ?? {}; await metric.set({ itemsReceived: (current.itemsReceived ?? 0) + 1, co2SavedKg: (current.co2SavedKg ?? 0) + Number(process.env.CO2_KG_PER_ITEM ?? 2.5), updatedAt: common_js_1.serverTimestamp }, { merge: true }); });
exports.cleanupExpiredItems = (0, scheduler_1.onSchedule)({ schedule: 'every 24 hours', region: common_js_1.region }, async () => { const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); const snap = await common_js_1.db.collection('items').where('status', '==', 'available').where('updatedAt', '<', cutoff).limit(500).get(); const batch = common_js_1.db.batch(); snap.docs.forEach((doc) => batch.update(doc.ref, { status: 'expired', updatedAt: common_js_1.serverTimestamp })); await batch.commit(); });
exports.dailyAnalyticsJob = (0, scheduler_1.onSchedule)({ schedule: 'every 24 hours', region: common_js_1.region }, async () => { const [users, items, requests] = await Promise.all([common_js_1.db.collection('users').count().get(), common_js_1.db.collection('items').count().get(), common_js_1.db.collection('requests').count().get()]); await common_js_1.db.doc('analytics/daily').set({ users: users.data().count, items: items.data().count, requests: requests.data().count, generatedAt: common_js_1.serverTimestamp }, { merge: true }); });
//# sourceMappingURL=index.js.map