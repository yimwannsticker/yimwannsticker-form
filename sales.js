// หน้า "ยอดขาย": ยอดขายรายเดือน (บาท) + แถบความคืบหน้าเทียบเป้า
// ข้อมูลอยู่ในแท็บ "ยอดขายรายเดือน" ของชีต แอดมินอัปไฟล์ CSV สรุปยอดขายเพื่ออัปเดต
(() => {
  "use strict";

  const CFG = window.APP_CONFIG;
  const API = (CFG.SHEET_API_URL || "").trim();
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const baht = (n) => "฿" + Math.round(Number(n) || 0).toLocaleString("th-TH");
  const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const TH_MONTH_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  const monthLabel = (m, full) => {
    const [y, mo] = m.split("-").map(Number);
    return `${(full ? TH_MONTH_FULL : TH_MONTH)[mo - 1]} ${full ? y + 543 : String(y + 543).slice(2)}`;
  };
  const ymOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

  let months = []; // [{month, gross, orders, channels, target}]

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("has-action");
    el.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove("show"), 2800);
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

  async function pull(showToast, force) {
    if (!API) { $("#salesNow").innerHTML = `<p class="hint">ยังไม่ได้ตั้งค่า Google Sheet</p>`; return; }
    try {
      const res = await fetch(`${API}?action=sales_list${force ? "&force=1" : ""}`);
      const data = await res.json();
      if (!data.ok || !Array.isArray(data.months)) throw new Error();
      months = data.months;
      applyDefaultTarget();
      const t = data.syncedAt ? new Date(data.syncedAt) : null;
      $("#salesSyncInfo").textContent = data.sync && data.sync.error
        ? "ดึงจาก Drive ไม่สำเร็จ: " + data.sync.error
        : t ? `ดึงจาก Drive ล่าสุด ${t.toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "";
      render();
      if (showToast) toast("อัปเดตแล้ว");
    } catch {
      $("#salesNow").innerHTML = `<p class="pack-warn">โหลดยอดขายไม่สำเร็จ ถ้าเพิ่งเพิ่มฟีเจอร์นี้ ต้องอัปเดตโค้ด Apps Script ก่อน</p>`;
      $("#salesList").innerHTML = "";
    }
  }

  // เป้ากลางจาก config: ใช้กับเดือนที่ยังไม่ได้ตั้งเป้าเอง ตั้งแต่ SALES_TARGET_FROM เป็นต้นไป
  function applyDefaultTarget() {
    const tiers = [].concat(CFG.SALES_TARGET || []).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
    const from = CFG.SALES_TARGET_FROM || "0000-00";
    if (!tiers.length) return;
    const thisMonth = ymOf(new Date());
    if (thisMonth >= from && !months.some((m) => m.month === thisMonth)) months.push({ month: thisMonth, gross: 0, orders: 0, channels: {}, target: 0 });
    for (const m of months) {
      if (m.target > 0 || m.month < from) continue;
      // เป้าปัจจุบัน = ขั้นแรกที่ยังไม่ถึง (ถึงทุกขั้นแล้ว = ขั้นสุดท้าย)
      m.target = tiers.find((t) => m.gross < t) || tiers[tiers.length - 1];
      m.passed = tiers.filter((t) => t < m.target);
      m.defaultTarget = true;
    }
    months.sort((a, b) => (a.month < b.month ? -1 : 1));
  }

  // ---------------- staff view ----------------
  function progressBar(gross, target, paceRatio, passed) {
    const pct = target > 0 ? (gross / target) * 100 : 0;
    const shown = Math.min(pct, 100);
    const pace = paceRatio != null ? Math.min(paceRatio * 100, 100) : null;
    return `
      <div class="sales-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}">
        <div class="sales-bar-fill ${pct >= 100 ? "done" : ""}" style="width:${shown}%"></div>
        ${(passed || []).map((t) => `<div class="sales-bar-tier" style="left:${(t / target) * 100}%"><span>${(t / 1000).toLocaleString("th-TH")}K</span></div>`).join("")}
        ${pace != null && pct < 100 ? `<div class="sales-bar-pace" style="left:${pace}%" title="ควรถึงวันนี้"></div>` : ""}
      </div>`;
  }

  function render() {
    const now = new Date();
    const thisMonth = ymOf(now);
    const cur = months.find((m) => m.month === thisMonth);
    const withSales = months.filter((m) => m.gross > 0);
    const latest = withSales[withSales.length - 1];
    const box = $("#salesNow");

    // การ์ดบน: เดือนนี้ (ถ้ามียอดหรือมีเป้า) ไม่งั้นแสดงเดือนล่าสุดที่มียอด
    const show = cur && (cur.gross > 0 || cur.target > 0) ? cur : latest;
    if (!show) {
      box.innerHTML = `<h2>ยอดขาย</h2><p class="hint">ยังไม่มีข้อมูลยอดขาย ระบบดึงจากไฟล์สรุปยอดขายใน Google Drive (โฟลเดอร์ sales-dashboard › data)</p>`;
    } else {
      const isCur = show.month === thisMonth;
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const pace = isCur ? now.getDate() / daysInMonth : null;
      const pct = show.target > 0 ? Math.round((show.gross / show.target) * 100) : null;
      const left = show.target > 0 ? Math.max(show.target - show.gross, 0) : 0;
      box.innerHTML = `
        <div class="sales-now-head">
          <span class="sales-eyebrow">${isCur ? "เดือนนี้" : "เดือนล่าสุด"} · ${esc(monthLabel(show.month, true))}</span>
        </div>
        <div class="sales-big">${baht(show.gross)}</div>
        ${show.target > 0 ? `
          ${show.passed && show.passed.length ? `<div class="sales-cheer">🎉 ทะลุเป้า ${baht(show.passed[show.passed.length - 1])} แล้ว! เป้าใหม่ ${baht(show.target)}</div>` : ""}
          ${progressBar(show.gross, show.target, pace, show.passed)}
          <div class="sales-meta">
            <span><b>${pct}%</b> ของเป้า ${baht(show.target)}</span>
            <span>${left > 0 ? `อีก ${baht(left)}` : "🎉 ถึงเป้าแล้ว"}</span>
          </div>
          ${isCur ? `<p class="hint">ขีดสีเขียวบนแถบ = ยอดที่ควรถึงภายในวันนี้ (วันที่ ${now.getDate()} จาก ${daysInMonth} วัน)</p>` : ""}`
        : `<p class="hint">ยังไม่ได้ตั้งเป้าของเดือนนี้</p>`}
        ${isCur && !(show.gross > 0) ? `<p class="hint">ยอดเดือนนี้จะขึ้นเมื่อมีไฟล์สรุปยอดขายของเดือนนี้ใน Google Drive</p>` : ""}`;
    }

    // รายการย้อนหลัง (ใหม่ → เก่า)
    const list = months.filter((m) => m.gross > 0).slice().reverse();
    const max = Math.max(1, ...list.map((m) => Math.max(m.gross, m.target || 0)));
    $("#salesList").innerHTML = list.length
      ? list.map((m) => {
          const pct = m.target > 0 ? Math.round((m.gross / m.target) * 100) : null;
          return `
          <div class="sales-row">
            <span class="sales-month">${esc(monthLabel(m.month))}</span>
            <div class="sales-track">
              <div class="sales-fill ${pct != null && pct >= 100 ? "done" : ""}" style="width:${(m.gross / max) * 100}%"></div>
              ${m.target > 0 ? `<div class="sales-target-mark" style="left:${(m.target / max) * 100}%" title="เป้า ${baht(m.target)}"></div>` : ""}
            </div>
            <span class="sales-val">${baht(m.gross)}${pct != null ? `<small class="${pct >= 100 || (m.passed && m.passed.length) ? "ok" : ""}">${pct >= 100 ? "✓ ถึงเป้า" : m.passed && m.passed.length ? `✓ ทะลุ ${Math.round(m.passed[m.passed.length - 1] / 1000)}K · ${pct}% ของ ${Math.round(m.target / 1000)}K` : pct + "% ของเป้า"}</small>` : ""}</span>
          </div>`;
        }).join("")
      : `<p class="hint">ยังไม่มีข้อมูล</p>`;

    renderTargetMonths();
  }

  function currentName() {
    for (const k of ["pack_employee_v1", "meter_employee_v1"]) {
      try { const v = JSON.parse(localStorage.getItem(k)); if (v) return v; } catch {}
    }
    return "";
  }

  // ---------------- admin: target ----------------
  function renderTargetMonths() {
    const sel = $("#salesTargetMonth");
    const keep = sel.value;
    const now = new Date();
    const opts = new Set();
    for (let i = -1; i <= 2; i++) opts.add(ymOf(new Date(now.getFullYear(), now.getMonth() + i, 1)));
    months.forEach((m) => opts.add(m.month));
    const list = [...opts].sort().reverse();
    sel.innerHTML = list.map((m) => `<option value="${m}">${esc(monthLabel(m, true))}</option>`).join("");
    sel.value = keep && list.includes(keep) ? keep : ymOf(now);
    fillTarget();
  }

  function fillTarget() {
    const m = months.find((x) => x.month === $("#salesTargetMonth").value);
    $("#salesTargetValue").value = m && m.target && !m.defaultTarget ? String(m.target) : "";
    const tiers = [].concat(CFG.SALES_TARGET || []);
    $("#salesTargetValue").placeholder = tiers.length ? `ค่าปกติ ${tiers.map((t) => Number(t).toLocaleString("th-TH")).join(" → ")}` : "เช่น 250000";
  }

  async function saveTarget(e) {
    e.preventDefault();
    const month = $("#salesTargetMonth").value;
    const target = Number(String($("#salesTargetValue").value).replace(/[,\s฿]/g, ""));
    if (!(target >= 0)) { toast("ใส่เป้าเป็นตัวเลข"); return; }
    const btn = e.submitter || $("#salesTargetForm button");
    btn.disabled = true;
    try {
      await post({ action: "sales_target", month, target, by: currentName() });
      toast(`ตั้งเป้า ${monthLabel(month, true)} = ${baht(target)}`);
      await pull();
    } catch (err) {
      toast("บันทึกไม่สำเร็จ: " + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------------- init ----------------
  $("#salesRefresh").addEventListener("click", () => pull(true));
  $("#salesSyncNow").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "กำลังดึง…";
    await pull(true, true);
    e.target.disabled = false;
    e.target.textContent = "⟳ ดึงจาก Drive ตอนนี้";
  });
  $("#salesTargetMonth").addEventListener("change", fillTarget);
  $("#salesTargetForm").addEventListener("submit", saveTarget);
  renderTargetMonths();
  window.addEventListener("viewchange", (e) => {
    if (e.detail === "sales") pull();
  });
})();
