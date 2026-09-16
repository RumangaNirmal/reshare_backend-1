import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

if (!getApps().length) initializeApp();
export const db = getFirestore();
export const messaging = getMessaging();
export const bucket = getStorage().bucket();
export const serverTimestamp = FieldValue.serverTimestamp();
export const region = process.env.DEFAULT_REGION ?? 'asia-south1';

export const id = z.string().min(1).max(128);
export const location = z.object({ city: z.string().min(1).max(100), district: z.string().min(1).max(100), province: z.string().min(1).max(100), lat: z.number().gte(-90).lte(90), lng: z.number().gte(-180).lte(180) });
export const itemInput = z.object({ title: z.string().trim().min(2).max(120), description: z.string().trim().min(2).max(2000), category: z.enum(['Furniture', 'Books', 'Electronics', 'Tools', 'Clothing', 'School Supplies']), condition: z.enum(['New', 'Good', 'Fair']), images: z.array(z.string().url()).max(8).default([]), location, tags: z.array(z.string().trim().min(1).max(30)).max(20).default([]) });
export const requestInput = z.object({ title: z.string().trim().min(2).max(120), description: z.string().trim().min(2).max(2000), reason: z.string().trim().min(2).max(1000), urgency: z.enum(['low', 'medium', 'high']), supportingDocuments: z.array(z.string().url()).max(5).default([]) });

export function requireUser(request: CallableRequest): string {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication is required.');
  return request.auth.uid;
}

export function requireAdmin(request: CallableRequest): string {
  const uid = requireUser(request);
  if (request.auth?.token.role !== 'admin') throw new HttpsError('permission-denied', 'Admin access is required.');
  return uid;
}

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpsError('invalid-argument', result.error.issues.map((issue) => issue.message).join('; '));
  return result.data;
}

export async function notify(userId: string, title: string, body: string, type: string): Promise<void> {
  const tokens = (await db.collection(`users/${userId}/fcmTokens`).get()).docs.map((doc) => doc.id);
  if (tokens.length) await messaging.sendEachForMulticast({ tokens, notification: { title, body }, data: { type } });
  await db.collection(`users/${userId}/notifications`).add({ userId, title, body, type, read: false, createdAt: serverTimestamp });
}

export function data<T extends Record<string, unknown> = Record<string, unknown>>(snapshot: FirebaseFirestore.DocumentSnapshot): T {
  return { id: snapshot.id, ...(snapshot.data() as Omit<T, 'id'>) } as unknown as T;
}