// ออเดอร์ Line: แอดมินกรอกทีละออเดอร์ตอนขายได้ (ข้อมูลสะสมในชีต "ออเดอร์ไลน์" ไม่ต้องกรอกใหม่ตั้งแต่วันที่ 1)
// ยอดของเดือนรวมเข้ายอดขายทันที (ช่องทาง "Line") และ export เป็น Excel ไปใส่ Dashboard ได้
(() => {
  "use strict";

  const CFG = window.APP_CONFIG;
  const API = (CFG.SHEET_API_URL || "").trim();
  const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "฿" + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("th-TH", { maximumFractionDigits: 2 });
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const label = (m) => (window.SalesMonthLabel ? window.SalesMonthLabel(m, true) : m);
  const dayLabel = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("th-TH", { day: "numeric", month: "short" }); };
  const num = (v) => Number(String(v ?? "").replace(/[,\s฿]/g, ""));

  let orders = [];      // ออเดอร์ของเดือนที่เลือก
  let prices = {};      // "A5|ประเภท" → ราคาต่อหน่วยล่าสุด
  let editing = null;   // id ที่กำลังแก้
  let loadedMonth = "";
  let unitTouched = false;

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("has-action");
    el.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove("show"), 2800);
  }

  function currentName() {
    for (const k of ["pack_employee_v1", "meter_employee_v1"]) {
      try { const v = JSON.parse(localStorage.getItem(k)); if (v) return v; } catch {}
    }
    return "";
  }

  async function post(body) {
    if (!API) throw new Error("ยังไม่ได้ตั้งค่า Google Sheet");
    let res;
    try {
      res = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) });
    } catch {
      throw new Error(navigator.onLine ? "ติดต่อ Google Sheet ไม่ได้" : "ไม่มีอินเทอร์เน็ต");
    }
    const data = await res.json().catch(() => ({ ok: false, error: "ตอบกลับผิดรูปแบบ" }));
    if (data.error === "unknown action") throw new Error("ต้องอัปเดตโค้ด Apps Script (Code.gs) ก่อน");
    if (!data.ok) throw new Error(data.error || "ไม่ทราบสาเหตุ");
    return data;
  }

  // ---------------- โหลด ----------------
  async function load(month) {
    month = month || $("#lineMonth").value || ym(new Date());
    if (!API) return;
    if (loadedMonth !== month) $("#lineList").innerHTML = `<p class="hint">กำลังโหลด…</p>`;
    try {
      const res = await fetch(`${API}?action=line_list&month=${month}`);
      const data = await res.json();
      if (!Array.isArray(data.orders)) throw new Error("old");
      if (($("#lineMonth").value || month) !== month) return;
      orders = data.orders;
      prices = data.prices || {};
      loadedMonth = month;
      $("#lineCustomers").innerHTML = (data.customers || []).map((c) => `<option value="${esc(c)}"></option>`).join("");
      $("#lineTypes").innerHTML = (data.types || []).filter((t) => !MATS.includes(t)).map((c) => `<option value="${esc(c)}"></option>`).join("");
      renderList();
    } catch (err) {
      $("#lineList").innerHTML = `<p class="pack-warn">${err.message === "old" ? "ต้องอัปเดตโค้ด Apps Script (Code.gs) ก่อน ถึงจะใช้ออเดอร์ Line ได้" : "โหลดออเดอร์ Line ไม่สำเร็จ ลองใหม่อีกครั้ง"}</p>`;
    }
  }

  function renderMonths() {
    const sel = $("#lineMonth");
    const keep = sel.value;
    const now = new Date();
    const opts = [];
    for (let i = 0; i < 6; i++) opts.push(ym(new Date(now.getFullYear(), now.getMonth() - i, 1)));
    sel.innerHTML = opts.map((m) => `<option value="${m}">${esc(label(m))}</option>`).join("");
    sel.value = keep && opts.includes(keep) ? keep : opts[0];
  }

  // ---------------- รายการ ----------------
  function renderList() {
    const box = $("#lineList");
    const list = orders.slice().sort((a, b) => (a.date === b.date ? (a.at < b.at ? 1 : -1) : a.date < b.date ? 1 : -1));
    const sales = list.reduce((a, o) => a + o.amount, 0);
    const ship = list.reduce((a, o) => a + o.ship, 0);
    const sheets = { A5: 0, A3: 0 };
    list.forEach((o) => { sheets[o.job] = (sheets[o.job] || 0) + o.qty; });
    $("#lineExport").disabled = !list.length;
    if (!list.length) { box.innerHTML = `<p class="hint">ยังไม่มีออเดอร์ Line ของ${esc(label($("#lineMonth").value))}</p>`; return; }
    box.innerHTML = `
      <div class="line-total">
        <div><b>${money(sales)}</b><span>ยอดขาย ${list.length} ออเดอร์</span></div>
        <div><b>${sheets.A5.toLocaleString("th-TH")} / ${sheets.A3.toLocaleString("th-TH")}</b><span>แผ่น A5 / A3</span></div>
        <div><b>${money(ship)}</b><span>ค่าส่ง (ไม่นับในยอด)</span></div>
      </div>
      <ul class="line-list">${list.map((o) => `
        <li class="${editing === o.id ? "editing" : ""}">
          <button type="button" class="line-row" data-edit="${esc(o.id)}" title="แตะเพื่อแก้ไข">
            <span class="line-date">${esc(dayLabel(o.date))}</span>
            <span class="line-main"><b>${esc(o.customer)}</b><span class="muted">${esc(o.job)}${o.type ? " · " + esc(o.type) : ""} · ${o.qty} แผ่น × ${money(o.unit)}${o.ship ? ` · ส่ง ${money(o.ship)}` : ""}</span></span>
            <span class="line-amt">${money(o.amount)}</span>
          </button>
          <button type="button" class="line-del" data-del="${esc(o.id)}" aria-label="ลบ">✕</button>
        </li>`).join("")}
      </ul>
      <p class="hint">แตะที่ออเดอร์เพื่อแก้ไข</p>`;
    box.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => startEdit(b.dataset.edit)));
    box.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => remove(b.dataset.del)));
  }

  // ---------------- ฟอร์ม ----------------
  const job = () => (document.querySelector('input[name="lineJob"]:checked') || {}).value || "";
  const OTHER = "__other";
  const MATS = (CFG.MATERIALS || []).map((m) => m.name);

  // ประเภทสติกเกอร์: กดเลือกจากวัสดุเดียวกับหน้าบันทึกมิเตอร์ + "อื่นๆ" ให้พิมพ์เอง
  function renderTypes() {
    $("#lineTypeChips").innerHTML = (CFG.MATERIALS || []).map((m) => `
      <label style="--mc:${esc(m.color)}"><input type="radio" name="lineTypePick" value="${esc(m.name)}" /><span>${esc(m.emoji)} ${esc(m.name)}</span></label>`).join("")
      + `<label style="--mc:#9aa7a2"><input type="radio" name="lineTypePick" value="${OTHER}" /><span>✏️ อื่นๆ</span></label>`;
    document.querySelectorAll('input[name="lineTypePick"]').forEach((r) => r.addEventListener("change", () => {
      const other = r.value === OTHER;
      $("#lineType").hidden = !other;
      if (other) $("#lineType").focus();
      suggestUnit();
    }));
  }
  function typeValue() {
    const v = (document.querySelector('input[name="lineTypePick"]:checked') || {}).value || "";
    return v === OTHER ? $("#lineType").value.trim() : v;
  }
  function setType(t) {
    const pick = !t ? "" : MATS.includes(t) ? t : OTHER;
    document.querySelectorAll('input[name="lineTypePick"]').forEach((r) => { r.checked = r.value === pick; });
    $("#lineType").value = pick === OTHER ? t : "";
    $("#lineType").hidden = pick !== OTHER;
  }

  function renderSum() {
    const qty = num($("#lineQty").value), unit = num($("#lineUnit").value), ship = num($("#lineShip").value) || 0;
    const amt = qty > 0 && unit >= 0 ? qty * unit : 0;
    $("#lineSum").innerHTML = amt || ship
      ? `ยอดขาย <b>${money(amt)}</b>${ship ? ` + ค่าส่ง ${money(ship)} = ลูกค้าจ่าย <b>${money(amt + ship)}</b>` : ""}`
      : "";
  }

  // จำราคา: เลือกประเภท + งานที่เคยขาย → เติมราคาต่อหน่วยครั้งล่าสุดให้ (แก้ได้)
  function suggestUnit() {
    if (unitTouched || editing) return;
    const p = prices[job() + "|" + typeValue()];
    if (p != null) { $("#lineUnit").value = p; renderSum(); }
  }

  function resetForm(keepDate) {
    const date = $("#lineDate").value;
    $("#lineForm").reset();
    setType("");
    $("#lineDate").value = keepDate && date ? date : ymd(new Date());
    editing = null;
    unitTouched = false;
    $("#lineSave").textContent = "บันทึกออเดอร์";
    $("#lineCancel").hidden = true;
    renderSum();
  }

  function startEdit(id) {
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    editing = id;
    $("#lineCustomer").value = o.customer;
    document.querySelectorAll('input[name="lineJob"]').forEach((r) => { r.checked = r.value === o.job; });
    setType(o.type);
    $("#lineQty").value = o.qty;
    $("#lineUnit").value = o.unit;
    $("#lineShip").value = o.ship || "";
    $("#lineDate").value = o.date;
    $("#lineSave").textContent = "บันทึกการแก้ไข";
    $("#lineCancel").hidden = false;
    renderSum();
    renderList();
    $("#lineForm").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function save(e) {
    e.preventDefault();
    const order = {
      id: editing || "",
      date: $("#lineDate").value,
      customer: $("#lineCustomer").value.trim(),
      job: job(),
      type: typeValue(),
      qty: num($("#lineQty").value),
      unit: num($("#lineUnit").value),
      ship: num($("#lineShip").value) || 0,
    };
    if (!order.job) { toast("เลือกงาน A5 หรือ A3"); return; }
    if (!order.type) { toast("เลือกประเภทสติกเกอร์"); return; }
    if (!(order.qty > 0) || !(order.unit >= 0)) { toast("ใส่จำนวนแผ่นและราคาให้ถูกต้อง"); return; }
    const btn = $("#lineSave");
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = "กำลังบันทึก…";
    try {
      await post({ action: "line_save", by: currentName(), order });
      toast(editing ? "✅ แก้ไขออเดอร์แล้ว" : `✅ บันทึกออเดอร์ ${order.customer} ${money(order.qty * order.unit)}`);
      prices[order.job + "|" + order.type] = order.unit;
      const m = order.date.slice(0, 7);
      if ($("#lineMonth").value !== m && [...$("#lineMonth").options].some((x) => x.value === m)) $("#lineMonth").value = m;
      resetForm(true);
      await load();
      window.dispatchEvent(new Event("salesdirty"));
    } catch (err) {
      toast("บันทึกไม่สำเร็จ: " + err.message);
      btn.textContent = was;
    } finally {
      btn.disabled = false;
      if (btn.textContent === "กำลังบันทึก…") btn.textContent = was;
    }
  }

  async function remove(id) {
    const o = orders.find((x) => x.id === id);
    if (!o || !confirm(`ลบออเดอร์ของ ${o.customer} (${o.qty} แผ่น ${money(o.amount)})?`)) return;
    try {
      await post({ action: "line_delete", id, by: currentName() });
      toast("ลบแล้ว (สำเนาอยู่ในแท็บ ออเดอร์ไลน์-ลบแล้ว)");
      if (editing === id) resetForm();
      await load();
      window.dispatchEvent(new Event("salesdirty"));
    } catch (err) {
      toast("ลบไม่สำเร็จ: " + err.message);
    }
  }

  // ---------------- Export Excel ----------------
  function loadScript(src) {
    return new Promise((ok, fail) => {
      if (window.XLSX) return ok();
      const el = document.createElement("script");
      el.src = src;
      el.onload = ok;
      el.onerror = () => fail(new Error("โหลดตัวสร้าง Excel ไม่สำเร็จ เช็คอินเทอร์เน็ต"));
      document.head.appendChild(el);
    });
  }

  async function exportXlsx() {
    const month = $("#lineMonth").value;
    const list = orders.slice().sort((a, b) => (a.date === b.date ? (a.at < b.at ? -1 : 1) : a.date < b.date ? -1 : 1));
    if (!list.length) return;
    try {
      await loadScript(XLSX_URL);
    } catch (err) { toast(err.message); return; }
    const X = window.XLSX;
    // แผ่น 1: รูปแบบเดียวกับหมวด "-- Line --" ในไฟล์ full_month ของ Dashboard
    const dash = [["Platform", "Order Date", "Order ID", "Buyer", "SKU", "Quantity", "Gross", "Fee", "Net"]];
    list.forEach((o, i) => dash.push(["Line", `${o.date} 00:00`, `LINE${o.date.replace(/-/g, "")}-${i + 1}`, o.customer, o.job, o.qty, o.amount, 0, o.amount]));
    const tq = list.reduce((a, o) => a + o.qty, 0), tg = Math.round(list.reduce((a, o) => a + o.amount, 0) * 100) / 100;
    dash.push(["", "", "", "", "Line Subtotal", tq, tg, 0, tg]);
    // แผ่น 2: รายละเอียดครบทุกช่อง
    const detail = [["วันที่", "ลูกค้า", "งาน", "ประเภทสติกเกอร์", "จำนวนแผ่น", "ราคาต่อหน่วย", "ยอดขาย (ไม่รวมค่าส่ง)", "ค่าส่ง", "รวมค่าส่ง", "บันทึกโดย"]];
    list.forEach((o) => detail.push([o.date, o.customer, o.job, o.type, o.qty, o.unit, o.amount, o.ship, o.total, o.by]));
    const ts = Math.round(list.reduce((a, o) => a + o.ship, 0) * 100) / 100;
    detail.push(["รวม", "", "", "", tq, "", tg, ts, Math.round((tg + ts) * 100) / 100, ""]);
    const wb = X.utils.book_new();
    const s1 = X.utils.aoa_to_sheet(dash);
    s1["!cols"] = [8, 16, 18, 22, 8, 10, 10, 6, 10].map((w) => ({ wch: w }));
    const s2 = X.utils.aoa_to_sheet(detail);
    s2["!cols"] = [11, 22, 6, 24, 10, 12, 18, 8, 10, 12].map((w) => ({ wch: w }));
    X.utils.book_append_sheet(wb, s1, "Dashboard");
    X.utils.book_append_sheet(wb, s2, "รายละเอียด");
    X.writeFile(wb, `line_orders_${month}.xlsx`);
  }

  // ---------------- init ----------------
  renderMonths();
  renderTypes();
  resetForm();
  $("#lineForm").addEventListener("submit", save);
  $("#lineCancel").addEventListener("click", () => { resetForm(); renderList(); });
  ["#lineQty", "#lineUnit", "#lineShip"].forEach((s) => $(s).addEventListener("input", renderSum));
  $("#lineUnit").addEventListener("input", () => { unitTouched = $("#lineUnit").value !== ""; });
  $("#lineType").addEventListener("change", suggestUnit);
  document.querySelectorAll('input[name="lineJob"]').forEach((r) => r.addEventListener("change", suggestUnit));
  $("#lineMonth").addEventListener("change", () => load());
  $("#lineExport").addEventListener("click", exportXlsx);
  $("#lineAdmin").addEventListener("toggle", () => { if ($("#lineAdmin").open) load(); });
  window.addEventListener("viewchange", (e) => {
    if (e.detail === "sales") { renderMonths(); if ($("#lineAdmin").open) load(); }
  });
  if (window.matchMedia("(min-width: 900px)").matches) $("#lineAdmin").open = true;
})();
