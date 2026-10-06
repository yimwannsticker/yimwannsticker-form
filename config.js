// ตั้งค่าแอพ — แก้ไขไฟล์นี้ไฟล์เดียวพอ
window.APP_CONFIG = {
  // URL ของ Google Apps Script Web App (ดูวิธีตั้งค่าใน README.md)
  // เว้นว่างไว้ = เก็บข้อมูลในเครื่องนี้อย่างเดียว
  SHEET_API_URL: "https://script.google.com/macros/s/AKfycbzkHwbBkbCB6pL6KxAlZovqAEYSpYILtshlACliL-CB1tSnm1H43yvjYb3d7v0ySfB8pA/exec",

  // รายชื่อพนักงาน
  EMPLOYEES: ["เบียร์", "ปาล์มมี่", "มิ้ว", "เตย"],

  // ประเภทวัสดุ (แต่ละประเภทมีทั้ง "สี" และ "ขาวดำ")
  MATERIALS: [
    { id: "pp_matte", name: "PP ด้าน", emoji: "🌫️", color: "#7c9cff" },
    { id: "pp_gloss", name: "PP เงา", emoji: "✨", color: "#ff8fb1" },
    { id: "paper_gloss", name: "กระดาษเงา", emoji: "📄", color: "#ffb84d" },
    { id: "pp_clear", name: "PP ใส", emoji: "💧", color: "#4cc9c0" },
    { id: "paper_art", name: "กระดาษอาร์ต", emoji: "🎨", color: "#b38cff" },
  ],
};
