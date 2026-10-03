// ตั้งค่าแอพ — แก้ไขไฟล์นี้ไฟล์เดียวพอ
window.APP_CONFIG = {
  // URL ของ Google Apps Script Web App (ดูวิธีตั้งค่าใน README.md)
  // เว้นว่างไว้ = เก็บข้อมูลในเครื่องนี้อย่างเดียว
  SHEET_API_URL: "https://script.googleusercontent.com/macros/echo?user_content_key=AUkAhnTLQ3KsuW70Mt5kXILsKLcV3lV2rYw7lOgy_iYo7GDtfpXoOUAyRUD9pJItvnPwA4EPmu949-JkSA61fRT-zYTos18kdlpxSLgOLvrTi60Ky-dkjnglzDzyi3O-oSKC5H-ogoDdXXI-FY4IoqBsazDY7JKj09t6APu9dAR2BckCGYxXcyQI8QKbs5MZhvNUd1in0LjLvIZk7YOZBnaZvRciLi2YaNizpr4obInSfsn5HTz93-QS9CrpLHXBtn6TWDLOd-uZVUIIN_yBf-wvcb6RtQ1Xng&lib=M1NGcFqS-X6FW2_Ns29rLYT8w52O2UgU4",

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
