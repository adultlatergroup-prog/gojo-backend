/**
 * GoJo Fare Engine (Version: Step Pricing)
 * ระบบคำนวณค่าโดยสารและตรวจสอบโปรโมชั่น
 * มาตรฐาน: รองรับเกณฑ์ราคาขั้นบันได, เงื่อนไขคูปอง
 */

 const admin = require('firebase-admin'); 
 const db = admin.firestore();   

// --- 1. Pricing Configuration (ส่วนตั้งค่าราคา) ---
const PRICING_CONFIG = {
    MIN_FARE: 100,      // ราคาขั้นต่ำ 100 บาท
    MAX_DISTANCE: 200,  // ระยะทางสูงสุดที่คำนวณ
    TIERS: [
        { start: 0,   end: 10,  rate: 20, baseFare: 0 },    
        { start: 10,  end: 20,  rate: 19, baseFare: 200 },  
        { start: 20,  end: 40,  rate: 18, baseFare: 390 },  
        { start: 40,  end: 60,  rate: 17, baseFare: 750 },  
        { start: 60,  end: 80,  rate: 15, baseFare: 1090 }, 
        { start: 80,  end: 100, rate: 13, baseFare: 1390 }, 
        { start: 100, end: 120, rate: 11, baseFare: 1650 }, 
        { start: 120, end: 140, rate: 9,  baseFare: 1870 }, 
        { start: 140, end: 160, rate: 7,  baseFare: 2050 }, 
        { start: 160, end: 200, rate: 5,  baseFare: 2190 }
    ]
};

// --- 2. Core Calculation Logic (ส่วนคำนวณหลัก) ---

/**
 * ฟังก์ชันคำนวณราคาตามระยะทาง (Logic ขั้นบันได)
 * @param {number} distance - ระยะทางจริง (กม.)
 * @returns {number} - ราคาที่คำนวณแล้ว (รวมราคาขั้นต่ำ)
 */
function calculateFare(distance) {
    const dist = Math.min(distance, PRICING_CONFIG.MAX_DISTANCE);
    
    // ค้นหา Tier ที่ตรงกับระยะทาง
    const tier = PRICING_CONFIG.TIERS.find(t => dist > t.start && dist <= t.end);

    if (tier) {
        const excessDist = dist - tier.start;
        const totalFare = tier.baseFare + (excessDist * tier.rate);
        
        // กฎราคาขั้นต่ำ 100 บาท
        return Math.max(Math.ceil(totalFare), PRICING_CONFIG.MIN_FARE);
    }
    
    // กรณีระยะทางเป็น 0 หรือไม่เข้าเงื่อนไข
    return PRICING_CONFIG.MIN_FARE;
}

// --- 3. Promotion & Coupon System (ส่วนระบบส่วนลด) ---

/**
 * ตรวจสอบความถูกต้องของคูปอง
 * @param {string} code - โค้ดส่วนลด
 * @param {number} currentFare - ราคาปัจจุบัน
 * @param {string} currentProvince - จังหวัดที่ใช้งาน
 */
async function validatePromoCode(code, currentFare, currentProvince) {
    if (!code) return { valid: false, msg: "กรุณาระบุโค้ดส่วนลด" };

    try {
        const promoRef = db.collection('promotions').doc(code.toUpperCase());
        const doc = await promoRef.get();

        if (!doc.exists) {
            return { valid: false, msg: "ไม่พบโค้ดส่วนลดนี้" };
        }

        const promo = doc.data();
        const now = new Date();

        // 1. ตรวจสอบสถานะและการหมดอายุ
        if (!promo.isActive || (promo.expiryDate && promo.expiryDate.toDate() < now)) {
            return { valid: false, msg: "โค้ดหมดอายุหรือถูกปิดใช้งานแล้ว" };
        }

        // 2. ตรวจสอบราคาขั้นต่ำของคูปอง
        if (currentFare < (promo.minFare || 0)) {
            return { valid: false, msg: `ยอดขั้นต่ำต้อง ฿${promo.minFare} ขึ้นไป` };
        }

        // 3. ตรวจสอบจำนวนสิทธิ์
        if (promo.usedCount >= promo.usageLimit) {
            return { valid: false, msg: "สิทธิ์โค้ดนี้เต็มแล้วครับ" };
        }

        // 4. ตรวจสอบพื้นที่ให้บริการ
        if (promo.province !== "all" && promo.province !== currentProvince) {
            return { valid: false, msg: `โค้ดนี้ใช้ได้เฉพาะในพื้นที่ ${promo.province}` };
        }

        return { 
            valid: true, 
            discount: promo.discountAmount, 
            type: promo.type, // 'fixed' หรือ 'percent'
            msg: "ใช้งานโค้ดสำเร็จ" 
        };

    } catch (error) {
        console.error("Promo Error:", error);
        return { valid: false, msg: "เกิดข้อผิดพลาดในการตรวจสอบโค้ด" };
    }
}

/**
 * คำนวณราคาหลังหักส่วนลด
 */
function applyDiscount(fare, promoResult) {
    if (!promoResult || !promoResult.valid) return fare;
    
    let finalFare = fare;
    if (promoResult.type === 'fixed') {
        finalFare = fare - promoResult.discount;
    } else if (promoResult.type === 'percent') {
        finalFare = fare - (fare * (promoResult.discount / 100));
    }
    
    return Math.max(Math.ceil(finalFare), 0);
}

// เพิ่มบรรทัดนี้ต่อท้ายไฟล์ เพื่อให้ index.js เรียกใช้งานได้
module.exports = { calculateFare, validatePromoCode, applyDiscount };