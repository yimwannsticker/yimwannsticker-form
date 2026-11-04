// คำนวณยอดขาย (Gross) จากไฟล์ออเดอร์ที่ export จาก Shopee (Order.all…xlsx) และ TikTok (ทั้งหมด คำสั่งซื้อ…csv)
// รับตารางเป็นอาร์เรย์ของแถว (แถวแรกเป็นหัวตาราง) คืนยอดแยกตามเดือนและช่องทาง
// หลักการเดียวกับ build_full_month.ps1 ของ Sales Dashboard: ไม่นับออเดอร์ที่ยกเลิก, แยก Shopee เป็น A5/A3 ตาม SKU
(function (root) {
  "use strict";

  const num = (v) => {
    const n = Number(String(v ?? "").replace(/[,\s฿]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const txt = (v) => String(v ?? "").replace(/\t/g, "").trim();
  const PAPER = "กระดาษ"; // กระดาษ

  // เหมือน ClassifyA5A3 ใน build_full_month.ps1
  function classifyA5A3(sku) {
    if (!sku.trim()) return "A5";
    const first = sku.split(";")[0].trim();
    if (/^\d+-/.test(first)) return "A5";
    if (/PP/.test(sku) || sku.includes(PAPER)) return "A3";
    return "A5";
  }

  function add(months, month, channel, g) {
    const m = (months[month] = months[month] || {});
    const c = (m[channel] = m[channel] || { g: 0, o: 0 });
    c.g = Math.round((c.g + g) * 100) / 100;
    c.o += 1;
  }

  // Shopee: ยอดต่อออเดอร์ = รวม "ราคาขายสุทธิ" ทุกบรรทัด − ส่วนลดที่ร้านออกเอง (โค้ดส่วนลด/Coins cashback/bundle ที่ผู้ขายจ่าย)
  // ส่วนลดที่ Shopee ออกให้ไม่หัก เพราะ Shopee จ่ายคืนร้าน
  function shopee(rows) {
    const h = rows[0].map(txt);
    const col = (name) => h.indexOf(name);
    const C = {
      id: col("หมายเลขคำสั่งซื้อ"),
      status: col("สถานะการสั่งซื้อ"),
      cancel: col("เหตุผลในการยกเลิกคำสั่งซื้อ"),
      date: col("วันที่ทำการสั่งซื้อ"),
      sku: col("ชื่อตัวเลือก"),
      net: col("ราคาขายสุทธิ"),
      voucher: col("โค้ดส่วนลดชำระโดยผู้ขาย"),
      coins: col("โค้ด Coins Cashback ชำระโดยผู้ขาย"),
      bundle: col("ส่วนลด bundle deal ชำระโดยผู้ขาย"),
    };
    if (C.id < 0 || C.net < 0 || C.date < 0) return { error: "ไฟล์ Shopee ไม่มีคอลัมน์ที่ต้องใช้ (หมายเลขคำสั่งซื้อ / ราคาขายสุทธิ / วันที่ทำการสั่งซื้อ)" };
    const orders = new Map();
    for (const r of rows.slice(1)) {
      const id = txt(r[C.id]);
      if (!id) continue;
      if (!orders.has(id)) orders.set(id, []);
      orders.get(id).push(r);
    }
    const months = {};
    const skipped = { cancelled: 0, unpaid: 0 };
    for (const [, lines] of orders) {
      const f = lines[0];
      const status = txt(f[C.status]);
      if (txt(f[C.cancel]) || status === "ยกเลิกแล้ว") { skipped.cancelled++; continue; }
      if (status === "ยังไม่ชำระ") { skipped.unpaid++; continue; }
      const month = txt(f[C.date]).slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) continue;
      let g = lines.reduce((a, l) => a + num(l[C.net]), 0);
      g -= C.voucher >= 0 ? num(f[C.voucher]) : 0;
      g -= C.coins >= 0 ? num(f[C.coins]) : 0;
      g -= C.bundle >= 0 ? lines.reduce((a, l) => a + num(l[C.bundle]), 0) : 0;
      const sku = lines.map((l) => txt(l[C.sku])).filter(Boolean).join("; ");
      add(months, month, "Shopee " + classifyA5A3(sku), g);
    }
    return { platform: "Shopee", orders: orders.size, months, skipped };
  }

  // TikTok: ยอดต่อออเดอร์ = รวม (SKU Subtotal Before Discount − SKU Seller Discount)
  // ส่วนลดที่แพลตฟอร์มออกให้ไม่หัก, ไม่รวมค่าส่ง
  function tiktok(rows) {
    const h = rows[0].map(txt);
    const col = (name) => h.indexOf(name);
    const C = {
      id: col("Order ID"),
      status: col("Order Status"),
      cancel: col("Cancelation/Return Type"),
      created: col("Created Time"),
      before: col("SKU Subtotal Before Discount"),
      seller: col("SKU Seller Discount"),
    };
    if (C.id < 0 || C.before < 0 || C.created < 0) return { error: "ไฟล์ TikTok ไม่มีคอลัมน์ที่ต้องใช้ (Order ID / SKU Subtotal Before Discount / Created Time)" };
    const orders = new Map();
    for (const r of rows.slice(1)) {
      const id = txt(r[C.id]);
      if (!id || r.length <= C.before) continue;
      if (!orders.has(id)) orders.set(id, []);
      orders.get(id).push(r);
    }
    const months = {};
    const skipped = { cancelled: 0, unpaid: 0 };
    for (const [, lines] of orders) {
      const f = lines[0];
      if (txt(f[C.cancel]) || txt(f[C.status]) === "ยกเลิกแล้ว") { skipped.cancelled++; continue; }
      const d = txt(f[C.created]).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (!d) continue;
      const month = `${d[3]}-${d[2]}`;
      const g = lines.reduce((a, l) => a + num(l[C.before]) - (C.seller >= 0 ? num(l[C.seller]) : 0), 0);
      add(months, month, "TikTok Shop", g);
    }
    return { platform: "TikTok", orders: orders.size, months, skipped };
  }

  // CSV แบบรองรับเครื่องหมายคำพูดและขึ้นบรรทัดในช่อง (TikTok มีข้อความผู้ซื้อหลายบรรทัด)
  function parseCsv(text) {
    text = String(text).replace(/^\uFEFF/, "");
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\r") continue;
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function parseRows(rows) {
    if (!rows || !rows.length) return { error: "ไฟล์ว่าง" };
    const h = rows[0].map(txt);
    if (h.includes("หมายเลขคำสั่งซื้อ")) return shopee(rows);
    if (h.includes("Order ID") && h.includes("Order Status")) return tiktok(rows);
    return { error: "ไม่รู้จักไฟล์นี้ ใช้ไฟล์คำสั่งซื้อจาก Shopee (Order.all…xlsx) หรือ TikTok (ทั้งหมด คำสั่งซื้อ…csv)" };
  }

  const api = { parseRows, parseCsv, classifyA5A3 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DailyParse = api;
})(typeof window !== "undefined" ? window : globalThis);
