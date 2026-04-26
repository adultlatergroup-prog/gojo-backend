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
exports.setAdminRole = functions.region("asia-southeast1").https.onCall(async (data, context) => {
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

// --- 3. ฟังก์ชันยกเลิกงานอัตโนมัติ (Scheduled Task) ---
exports.scheduledAutoCancelJobs = functions.region("asia-southeast1").pubsub
    .schedule('every 1 minutes') // รันทุก 1 นาที เพื่อเช็คงาน
    .onRun(async (context) => {
        const now = admin.firestore.Timestamp.now();
        const twoMinutesAgo = new Date(now.toDate().getTime() - 2 * 60 * 1000);

        // ค้นหางานที่ค้างเกิน 2 นาที และสถานะยังเป็น 'pending'
        const snapshot = await admin.firestore().collection('jobs')
            .where('status', '==', 'pending')
            .where('createdAt', '<', admin.firestore.Timestamp.fromDate(twoMinutesAgo))
            .get();

        if (snapshot.empty) return null;

        // ทำการยกเลิกงานที่ค้าง
        const batch = admin.firestore().batch();
        snapshot.docs.forEach(doc => {
            batch.update(doc.ref, { 
                status: 'cancelled', 
                cancelReason: 'timeout_no_driver_auto' 
            });
        });

        await batch.commit();
        console.log(`🧹 ยกเลิกงานค้างไปแล้ว ${snapshot.size} งาน`);
    });