// ตั้งค่าแอพ — แก้ไขไฟล์นี้ไฟล์เดียวพอ
window.APP_CONFIG = {
  // URL ของ Google Apps Script Web App (ดูวิธีตั้งค่าใน README.md)
  // เว้นว่างไว้ = เก็บข้อมูลในเครื่องนี้อย่างเดียว
  SHEET_API_URL: "https://script.google.com/macros/s/AKfycbzkHwbBkbCB6pL6KxAlZovqAEYSpYILtshlACliL-CB1tSnm1H43yvjYb3d7v0ySfB8pA/exec",

  // รายชื่อพนักงาน
  EMPLOYEES: ["เบียร์", "ปาล์มมี่", "มิ้ว", "เตย"],

  // รายชื่อคนแพ็ค (แท็บเช็คแพ็ค) — ถ้าไม่ใส่ จะใช้ EMPLOYEES
  PACKERS: ["เบียร์", "ปาล์มมี่", "มิ้ว", "เตย", "เฟรนด์"],

  // เป้ายอดขายต่อเดือน (บาท) เป็นขั้น: ถึงขั้นแรกแล้วขยับไปขั้นถัดไป
  // ใช้กับเดือนนี้เป็นต้นไปที่ยังไม่ได้ตั้งเป้าเฉพาะเดือน
  SALES_TARGET: [300000, 500000],
  SALES_TARGET_FROM: "2026-11",

  // ลิงก์แดชบอร์ดยอดขายเวอร์ชั่นเต็ม (artifact "Yimwann Sticker · Sales Dashboard")
  // ลิงก์นี้เปิดเวอร์ชันล่าสุดเสมอ อัปเดตแดชบอร์ดหลักแล้วไม่ต้องแก้ที่นี่
  SALES_DASHBOARD_URL: "https://claude.ai/artifact/M37BQ3LQFzk1Nqub46c6E7",

  // เรทราคาออเดอร์ Line (บาท/แผ่น) ใช้เติมราคาต่อหน่วย (และค่าส่ง) ให้อัตโนมัติตามจำนวนแผ่น
  // tiers: [จำนวนขั้นต่ำ, ราคาต่อแผ่น] เรียงจากมากไปน้อย · "*" = ทุกประเภท
  // freeShipFrom = ส่งฟรีตั้งแต่กี่แผ่น · shipBelow = ค่าส่งถ้าน้อยกว่านั้น (ไม่ใส่ = กรอกเอง)
  LINE_RATES: {
    A3: {
      freeShipFrom: 20,
      tiers: {
        "กระดาษเงา": [[300, 19], [100, 22], [50, 24], [10, 25], [0, 30]],
        "PP ด้าน": [[300, 23], [100, 26], [50, 28], [10, 29], [0, 35]],
        "PP เงา": [[300, 23], [100, 26], [50, 28], [10, 29], [0, 35]],
        "PP ใส": [[300, 23], [100, 26], [50, 28], [10, 29], [0, 35]],
      },
    },
    A5: {
      freeShipFrom: 15,
      shipBelow: 30,
      tiers: { "*": [[100, 10], [50, 11], [15, 12], [0, 15]] },
    },
  },

  // ประเภทวัสดุ (แต่ละประเภทมีทั้ง "สี" และ "ขาวดำ")
  MATERIALS: [
    { id: "pp_matte", name: "PP ด้าน", emoji: "🌫️", color: "#7c9cff" },
    { id: "pp_gloss", name: "PP เงา", emoji: "✨", color: "#ff8fb1" },
    { id: "paper_gloss", name: "กระดาษเงา", emoji: "📄", color: "#ffb84d" },
    { id: "pp_clear", name: "PP ใส", emoji: "💧", color: "#4cc9c0" },
    { id: "paper_art", name: "กระดาษอาร์ต", emoji: "🎨", color: "#b38cff" },
  ],
};
