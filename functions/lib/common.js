"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestInput = exports.itemInput = exports.location = exports.id = exports.region = exports.serverTimestamp = exports.bucket = exports.messaging = exports.db = void 0;
exports.requireUser = requireUser;
exports.requireAdmin = requireAdmin;
exports.parse = parse;
exports.notify = notify;
exports.data = data;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const messaging_1 = require("firebase-admin/messaging");
const storage_1 = require("firebase-admin/storage");
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
if (!(0, app_1.getApps)().length)
    (0, app_1.initializeApp)();
exports.db = (0, firestore_1.getFirestore)();
exports.messaging = (0, messaging_1.getMessaging)();
exports.bucket = (0, storage_1.getStorage)().bucket();
exports.serverTimestamp = firestore_1.FieldValue.serverTimestamp();
exports.region = process.env.DEFAULT_REGION ?? 'asia-south1';
exports.id = zod_1.z.string().min(1).max(128);
exports.location = zod_1.z.object({ city: zod_1.z.string().min(1).max(100), district: zod_1.z.string().min(1).max(100), province: zod_1.z.string().min(1).max(100), lat: zod_1.z.number().gte(-90).lte(90), lng: zod_1.z.number().gte(-180).lte(180) });
exports.itemInput = zod_1.z.object({ title: zod_1.z.string().trim().min(2).max(120), description: zod_1.z.string().trim().min(2).max(2000), category: zod_1.z.enum(['Furniture', 'Books', 'Electronics', 'Tools', 'Clothing', 'School Supplies']), condition: zod_1.z.enum(['New', 'Good', 'Fair']), images: zod_1.z.array(zod_1.z.string().url()).max(8).default([]), location: exports.location, tags: zod_1.z.array(zod_1.z.string().trim().min(1).max(30)).max(20).default([]) });
exports.requestInput = zod_1.z.object({ title: zod_1.z.string().trim().min(2).max(120), description: zod_1.z.string().trim().min(2).max(2000), reason: zod_1.z.string().trim().min(2).max(1000), urgency: zod_1.z.enum(['low', 'medium', 'high']), supportingDocuments: zod_1.z.array(zod_1.z.string().url()).max(5).default([]) });
function requireUser(request) {
    if (!request.auth?.uid)
        throw new https_1.HttpsError('unauthenticated', 'Authentication is required.');
    return request.auth.uid;
}
function requireAdmin(request) {
    const uid = requireUser(request);
    if (request.auth?.token.role !== 'admin')
        throw new https_1.HttpsError('permission-denied', 'Admin access is required.');
    return uid;
}
function parse(schema, value) {
    const result = schema.safeParse(value);
    if (!result.success)
        throw new https_1.HttpsError('invalid-argument', result.error.issues.map((issue) => issue.message).join('; '));
    return result.data;
}
async function notify(userId, title, body, type) {
    const tokens = (await exports.db.collection(`users/${userId}/fcmTokens`).get()).docs.map((doc) => doc.id);
    if (tokens.length)
        await exports.messaging.sendEachForMulticast({ tokens, notification: { title, body }, data: { type } });
    await exports.db.collection(`users/${userId}/notifications`).add({ userId, title, body, type, read: false, createdAt: exports.serverTimestamp });
}
function data(snapshot) {
    return { id: snapshot.id, ...snapshot.data() };
}
//# sourceMappingURL=common.js.map