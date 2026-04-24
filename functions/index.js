const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
admin.initializeApp();

// 🚩 นำเข้า Engine ที่เราแยกไว้
const fareEngine = require("./fare-engine"); 

// --- 1. ฟังก์ชันจองรถ (ใช้งานปกติ) ---
exports.createSecureBooking = functions.region("asia-southeast1").https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบ");

    const { pickup, dropoff, distance, bookingType, pickupDetail, promoCode } = data;

    let serverFare = fareEngine.calculateFare(distance);

    if (promoCode) {
        const promoResult = await fareEngine.validatePromoCode(promoCode, serverFare, data.province || "all");
        if (promoResult.valid) {
            serverFare = fareEngine.applyDiscount(serverFare, promoResult);
        }
    }

    try {
        const jobRef = await admin.firestore().collection("jobs").add({
            passengerId: context.auth.uid,
            passengerName: data.passengerName || "ผู้โดยสาร GoJo",
            pickup,
            dropoff,
            distance,
            fare: serverFare,
            status: "pending",
            bookingType,
            pickupDetail,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, jobId: jobRef.id, fare: serverFare };
    } catch (error) {
        throw new functions.https.HttpsError("internal", error.message);
    }
});

// --- 2. ฟังก์ชันตั้งค่า Admin (ใช้งานเฉพาะตอนอัปเกรด User) ---
// เรียกใช้ผ่าน HTTP URL หรือใน Console เท่านั้น ไม่ต้องรันบ่อย
exports.setAdminRole = functions.region("asia-southeast1").https.onCall(async (data, context) => {
    // 🚩 กฎความปลอดภัย: เฉพาะแอดมินเท่านั้นที่จะมีสิทธิ์อัปเกรดคนอื่น
    if (!context.auth || context.auth.token.admin !== true) {
        throw new functions.https.HttpsError("permission-denied", "คุณไม่มีสิทธิ์ใช้งานฟังก์ชันนี้");
    }

    const uid = data.uid;
    try {
        await admin.auth().setCustomUserClaims(uid, { admin: true });
        return { success: true, message: `อัปเกรด UID: ${uid} เป็น Admin สำเร็จ!` };
    } catch (error) {
        throw new functions.https.HttpsError("internal", error.message);
    }
});