const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
admin.initializeApp();

// 🚩 นำเข้า Engine ที่เราแยกไว้
const fareEngine = require("./fare-engine"); 

exports.createSecureBooking = functions.region("asia-southeast1").https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบ");

    const { pickup, dropoff, distance, bookingType, pickupDetail, promoCode } = data;

    // 🚩 เรียกผ่าน Engine (สะอาดและปลอดภัย)
    let serverFare = fareEngine.calculateFare(distance);

    // 🚩 ถ้ามีการส่ง promoCode มา ให้ตรวจสอบและหักส่วนลดที่หลังบ้านด้วย
    if (promoCode) {
        // ดึงจังหวัดมาตรวจสอบ (สมมติว่าส่งมาใน data)
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