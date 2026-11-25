// หน้า "เช็คแพ็ค": อัปโหลด PDF ใบปะ → สแกนเลขพัสดุ → ติ๊กของครบ → บันทึกคนแพ็ค
(() => {
  "use strict";

  const CFG = window.APP_CONFIG;
  const API = (CFG.SHEET_API_URL || "").trim();
  const LS_EMP = "pack_employee_v1";
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  const SCANNER = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";

  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const timeTH = (iso) => (iso ? new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
  const sameDay = (iso, d) => iso && new Date(iso).toDateString() === d.toDateString();

  let employee = "";
  try { employee = JSON.parse(localStorage.getItem(LS_EMP)) || JSON.parse(localStorage.getItem("meter_employee_v1")) || ""; } catch {}
  let orders = [];       // จากชีต
  let loadedAt = 0;
  let current = null;    // ออเดอร์ที่กำลังเช็ค
  let ticked = new Set();
  let scanner = null;
  let parsed = null;     // ผลอ่าน PDF ที่ยังไม่ได้ส่ง

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("has-action");
    el.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove("show"), 2800);
  }

  function loadScript(src) {
    return new Promise((ok, fail) => {
      if ([...document.scripts].some((s) => s.src === src)) return ok();
      const s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = () => fail(new Error("โหลดไลบรารีไม่สำเร็จ เช็คอินเทอร์เน็ต"));
      document.head.appendChild(s);
    });
  }

  // ---------------- API ----------------
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

  async function pull(showToast) {
    if (!API) return;
    try {
      const res = await fetch(`${API}?action=pack_list`);
      const data = await res.json();
      if (!data.ok || !Array.isArray(data.orders)) throw new Error();
      orders = data.orders;
      // รายการที่บันทึกแล้วแต่ยังส่งขึ้นชีตไม่ถึง ให้นับว่าแพ็คแล้ว
      for (const job of queue) {
        const o = orders.find((x) => x.tracking === job.tracking);
        if (o && !o.packedBy) { o.packedBy = job.by; o.packedAt = new Date().toISOString(); }
      }
      loadedAt = Date.now();
      renderProgress();
      if (showToast) toast("อัปเดตแล้ว");
    } catch {
      $("#packProgress").innerHTML = `<p class="pack-warn">โหลดรายการไม่สำเร็จ ถ้าเพิ่งเพิ่มฟีเจอร์นี้ ต้องอัปเดตโค้ด Apps Script ก่อน</p>`;
    }
  }

  // ---------------- employee ----------------
  function renderEmployees() {
    const box = $("#packEmployeeList");
    box.innerHTML = "";
    (CFG.PACKERS || CFG.EMPLOYEES).forEach((name) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "emp" + (name === employee ? " selected" : "");
      b.textContent = name;
      b.addEventListener("click", () => {
        employee = name;
        try { localStorage.setItem(LS_EMP, JSON.stringify(name)); } catch {}
        renderEmployees();
        renderProgress();
      });
      box.appendChild(b);
    });
  }

  function needEmployee() {
    if (employee) return false;
    const box = $("#packEmployeeList");
    box.classList.remove("shake");
    void box.offsetWidth;
    box.classList.add("shake");
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    toast("เลือกชื่อคนแพ็คก่อน");
    return true;
  }

  // ชื่อ SKU ที่จะแสดง (ข้อมูลที่อัปไว้ก่อนแก้ตัวอ่าน อาจมี "Order ID: …" ติดมาในช่อง Seller SKU)
  function skuOf(it) {
    const seller = /^(Order ID|Package ID)\s*:/i.test(it.sellerSku || "") ? "" : it.sellerSku;
    return seller || it.sku;
  }

  // ---------------- สีจากชื่อ SKU ----------------
  // ลายที่มีหลายสี ชื่อ SKU จะมีสีเป็นท่อนหนึ่ง เช่น "03-100%-01,ขาว" / "33-25บาท-แดง"
  // ต้องเป็นทั้งท่อน (คั่นด้วย - หรือ ,) จึงนับเป็นสี — "ชาเขียว", "มะม่วง", "ฝอยทอง" ไม่นับ
  const COLORS = [
    // [ชื่อที่ใช้ได้, สีพื้น, สีตัวอักษร]
    [["ดำ", "black"], "#161616", "#fff"],
    [["ขาว", "white"], "#ffffff", "#161616"],
    [["แดง", "red"], "#d62828", "#fff"],
    [["ม่วง", "purple"], "#7b3fa0", "#fff"],
    [["เขียว", "green"], "#2e9e44", "#fff"],
    [["ฟ้า", "sky"], "#5bb8ea", "#10283a"],
    [["น้ำเงิน", "กรม", "navy", "blue"], "#1f3f9e", "#fff"],
    [["เหลือง", "yellow"], "#ffd60a", "#2b2300"],
    [["ชมพู", "pink"], "#f48fb1", "#3a0d1c"],
    [["ส้ม", "orange"], "#f77f00", "#fff"],
    [["น้ำตาล", "brown"], "#7a4a24", "#fff"],
    [["เทา", "gray", "grey"], "#8a8a8a", "#fff"],
    [["ทอง", "gold"], "#c9a227", "#231a00"],
    [["เงิน", "silver"], "#c4c7cc", "#161616"],
  ];
  const COLOR_BY = new Map();
  COLORS.forEach(([names, bg, fg]) => names.forEach((n) => COLOR_BY.set(n.toLowerCase(), { name: names[0], bg, fg })));
  // PDF บางไฟล์เขียน "ำ" เป็น "ํ"+"า" (ดํา, น้ําเงิน)
  const fixAm = (t) => String(t || "").replace(/\u0E4D([\u0E48-\u0E4B]?)\u0E32/g, "$1\u0E33");
  function colorOf(it) {
    for (const src of [it.sellerSku, it.sku]) {
      const parts = fixAm(src).split(/[-,/|()]/).map((x) => x.trim().toLowerCase().replace(/^สี\s*/, "")).filter(Boolean);
      for (let i = parts.length - 1; i >= 0; i--) {
        const c = COLOR_BY.get(parts[i]);
        if (c) return c;
      }
    }
    return null;
  }

  // ---------------- รูปสติกเกอร์ ----------------
  // ลายที่มีรูปใน stickers/index.js จะแสดงรูปแทนช่องรหัส + ปุ่ม 🔍 ดูเต็มจอ
  const normSku = (t) => fixAm(t).normalize("NFC").replace(/\s+/g, "");
  let stickerMap = null;
  function stickerOf(it) {
    if (!stickerMap) {
      stickerMap = new Map();
      for (const [k, v] of Object.entries(window.STICKER_IMAGES || {})) stickerMap.set(normSku(k), { file: v, name: k });
    }
    for (const src of [skuOf(it), it.sellerSku, it.sku]) {
      const t = String(src || "").trim();
      if (!t) continue;
      const n = normSku(t);
      let hit = stickerMap.get(n) || stickerMap.get(normSku(t.split(/[,;]/)[0]));
      // ชื่อที่มีอย่างอื่นต่อท้าย เช่น "95-ซานต้า-A5" / "95-ซานต้า(ใหญ่)" → ใช้รูปของ "95-ซานต้า" (เลือกชื่อที่ยาวที่สุดที่ตรง)
      if (!hit) {
        for (const [k, v] of stickerMap) {
          if (n.startsWith(k) && /^[-,;(_/|]/.test(n.slice(k.length)) && (!hit || k.length > normSku(hit.name).length)) hit = v;
        }
      }
      if (hit) return hit;
    }
    return null;
  }
  function codeBox(it) {
    const st = stickerOf(it);
    if (!st) return `<span class="pack-code">${esc(it.code || "?")}</span>`;
    return `<span class="pack-thumb">
        <img src="stickers/${encodeURIComponent(st.file)}.webp" alt="${esc(st.name)}" loading="lazy" />
        ${it.code ? `<span class="pack-thumb-code">${esc(it.code)}</span>` : ""}
        <span class="pack-zoom" role="button" tabindex="0" aria-label="ดูรูปเต็มจอ" data-zoom="${esc(st.file)}" data-name="${esc(st.name)}">🔍</span>
      </span>`;
  }
  function openZoom(file, name) {
    let d = $("#stickerZoom");
    if (!d) {
      d = document.createElement("div");
      d.id = "stickerZoom";
      d.className = "sticker-zoom";
      d.innerHTML = `<button type="button" class="sticker-zoom-close" aria-label="ปิด">✕</button><img alt="" /><div class="sticker-zoom-name"></div>`;
      d.addEventListener("click", () => d.classList.remove("show"));
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") d.classList.remove("show"); });
      document.body.appendChild(d);
    }
    $("img", d).src = `stickers/${encodeURIComponent(file)}@full.webp`;
    $("img", d).alt = name;
    $(".sticker-zoom-name", d).textContent = name;
    d.classList.add("show");
  }

  // ---------------- scan ----------------
  // ระหว่างแพ็ค กล้องค้างไว้แบบ "พัก" (หยุดอ่านภาพ ไม่กินแบต) → กล่องถัดไปสแกนต่อได้ทันที
  // ประหยัดแบต: ไม่มีอะไรให้สแกนนาน หรือพักนานเกิน หรือสลับไปแอพอื่น → ปิดกล้องจริง
  const IDLE_SCAN_MS = 30000;   // เปิดกล้องรอสแกนแต่ไม่เจอโค้ดเลย
  const PAUSED_MAX_MS = 90000;  // พักกล้องระหว่างหยิบของนานเกินนี้ ปิดกล้อง แล้วเปิดใหม่ตอนกดถัดไป
  let scanPaused = false;
  let cameraWanted = false;     // ผู้ใช้กำลังใช้โหมดกล้อง (เปิดกล้องให้ใหม่อัตโนมัติหลังบันทึก)
  let idleTimer = 0;
  let lastCode = "";
  let lastCodeAt = 0;

  function armIdle(ms, onIdle) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(onIdle, ms);
  }

  function preloadScanner() {
    loadScript(SCANNER).catch(() => {});
  }

  // กล้องแต่ละรอบมีกล่องของตัวเองใน #packReader และต้องปิดรอบเก่าให้เสร็จก่อนเปิดรอบใหม่
  // (เคยมีปัญหา: งานปิดกล้องเก่าที่ช้า ไปปิดวิดีโอของกล้องใหม่ → จอดำ/ค้าง ต้องออกเข้าใหม่)
  let stopping = Promise.resolve();
  let starting = false;
  let boxSeq = 0;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function startScan() {
    if (needEmployee()) return;
    cameraWanted = true;
    if (scanner) { resumeScan(); return; }
    if (starting) return;
    starting = true;
    $("#packScanBtn").disabled = true;
    let sc = null;
    try {
      await loadScript(SCANNER);
      await stopping;
      if (!cameraWanted) return;
      const F = window.Html5QrcodeSupportedFormats;
      const reader = $("#packReader");
      reader.hidden = false;
      reader.classList.remove("paused");
      $("#packStopBtn").hidden = false;
      $("#packScanBtn").hidden = true;
      scanPaused = false;
      const box = document.createElement("div");
      box.id = "packReaderBox" + ++boxSeq;
      reader.appendChild(box);
      sc = new window.Html5Qrcode(box.id, {
        // อ่านเฉพาะ QR code (เร็วกว่าอ่านหลายแบบพร้อมกันมาก) บาร์โค้ดใช้ช่องพิมพ์/เครื่องยิงแทน
        formatsToSupport: [F.QR_CODE],
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        verbose: false,
      });
      sc.box = box;
      scanner = sc;
      await sc.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: (w, h) => { const side = Math.floor(Math.min(w, h) * 0.7); return { width: side, height: side }; },
          videoConstraints: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        },
        onCode,
        () => {}
      );
      // ระหว่างรอกล้องเปิด ผู้ใช้สลับแอพ/กดปิดไปแล้ว → ปิดกล้องตัวนี้ทิ้ง
      if (scanner !== sc) { closeCamera(sc); return; }
      armIdle(IDLE_SCAN_MS, autoOff);
    } catch (err) {
      if (sc && scanner === sc) stopScan();
      else if (sc) closeCamera(sc);
      const msg = String(err && (err.message || err));
      toast(/Permission|NotAllowed/i.test(msg) ? "ไม่ได้รับอนุญาตให้ใช้กล้อง ไปเปิดสิทธิ์กล้องในการตั้งค่าเบราว์เซอร์" : "เปิดกล้องไม่ได้: " + msg);
    } finally {
      starting = false;
      $("#packScanBtn").disabled = false;
    }
  }

  function onCode(text) {
    if (scanPaused) return;
    const t = String(text || "").trim();
    // ใบปะกล่องที่เพิ่งสแกนยังอยู่หน้ากล้อง → ไม่เปิดซ้ำจนกว่าจะสแกนใบอื่น
    if (t === lastCode) return;
    lastCode = t;
    lastCodeAt = Date.now();
    if (navigator.vibrate) navigator.vibrate(80);
    pauseScan();
    lookup(t);
  }

  function pauseScan() {
    scanPaused = true;
    $("#packReader").classList.add("paused");
    // หยุดอ่านภาพและหยุดวิดีโอจริง (ไม่ใช่แค่ซ่อน) ระหว่างหยิบของ
    try { scanner && scanner.pause(true); } catch {}
    armIdle(PAUSED_MAX_MS, () => stopScan(true));
  }

  // สตรีมกล้องยังใช้ได้อยู่ไหม (มือถือบางรุ่นตัดกล้องทิ้งเองตอนพักนาน)
  function cameraLive(sc) {
    return [...sc.box.querySelectorAll("video")].some((v) =>
      v.srcObject && v.srcObject.getVideoTracks && v.srcObject.getVideoTracks().some((t) => t.readyState === "live"));
  }

  function restartScan() {
    stopScan(true);
    startScan();
  }

  function resumeScan() {
    if (!cameraWanted) return;
    if (!scanner) { startScan(); return; }
    const sc = scanner;
    scanPaused = false;
    $("#packReader").classList.remove("paused");
    $("#packReader").scrollIntoView({ behavior: "smooth", block: "center" });
    try {
      if (!cameraLive(sc)) throw new Error("camera ended");
      sc.resume();
    } catch {
      restartScan();
      return;
    }
    // วิดีโอไม่กลับมาเล่นภายใน 1.5 วิ (ไลบรารีจะค้างสถานะพักไว้) → เปิดกล้องใหม่
    setTimeout(() => {
      if (scanner === sc && !scanPaused && sc.getState && sc.getState() !== 2 /* SCANNING */) restartScan();
    }, 1500);
    armIdle(IDLE_SCAN_MS, autoOff);
  }

  // เปิดกล้องรอแต่ไม่ได้สแกนอะไร → ปิดเพื่อประหยัดแบต
  function autoOff() {
    if (!scanner || scanPaused) return;
    stopScan();
    toast("ปิดกล้องให้แล้วเพื่อประหยัดแบต กด “📷 สแกนใบปะ” เพื่อสแกนต่อ");
  }

  // ปิดกล้องตัวนี้ให้ขาดจริง แล้วลบกล่องของมันทิ้ง (แตะเฉพาะวิดีโอของตัวเอง ไม่ยุ่งกับกล้องรอบใหม่)
  function closeCamera(sc) {
    const vids = [...sc.box.querySelectorAll("video")];
    const release = () => {
      vids.forEach((v) => {
        (v.srcObject && v.srcObject.getTracks ? v.srcObject.getTracks() : []).forEach((t) => t.stop());
        v.srcObject = null;
      });
      sc.box.remove();
    };
    let p;
    try { p = Promise.resolve(sc.stop()); } catch { p = Promise.resolve(); }
    // ไลบรารีบางทีหยุดช้ามาก (เช่น เพิ่งกลับจากพื้นหลัง) → รอไม่เกิน 1.5 วิ แล้วตัดเอง
    const done = Promise.race([p.catch(() => {}), wait(1500)]).then(release, release);
    stopping = stopping.then(() => done);
    return done;
  }

  // keepWanted = ปิดกล้องชั่วคราว (พักนาน/สลับแอพ) แล้วเปิดให้ใหม่ตอนสแกนกล่องถัดไป
  function stopScan(keepWanted) {
    const s = scanner;
    scanner = null;
    scanPaused = false;
    if (keepWanted !== true) cameraWanted = false;
    clearTimeout(idleTimer);
    if (s) closeCamera(s);
    $("#packReader").hidden = true;
    $("#packReader").classList.remove("paused");
    $("#packStopBtn").hidden = true;
    $("#packScanBtn").hidden = false;
  }

  function findOrder(text) {
    const t = String(text || "").trim().toUpperCase();
    if (!t) return null;
    return (
      orders.find((o) => o.tracking.toUpperCase() === t) ||
      orders.find((o) => o.orderId && o.orderId === t) ||
      orders.find((o) => t.includes(o.tracking.toUpperCase())) ||
      null
    );
  }

  async function lookup(text) {
    if (needEmployee()) return;
    let o = findOrder(text);
    if (!o && Date.now() - loadedAt > 5000) {
      await pull();
      o = findOrder(text);
    }
    $("#packInput").value = "";
    if (!o) return showNotFound(text);
    current = o;
    ticked = new Set();
    renderResult(true);
  }

  // ---------------- result ----------------
  function showNotFound(text) {
    current = null;
    $("#packResult").innerHTML = `
      <div class="card pack-card bad">
        <div class="pack-banner bad">❌ ไม่พบเลขพัสดุนี้ในระบบ</div>
        <p class="pack-track">${esc(text)}</p>
        <p class="hint">อาจยังไม่ได้อัปโหลด PDF ชุดนี้ หรือสแกนผิดโค้ด (สแกน QR code หรือบาร์โค้ดใหญ่ของใบปะ) อย่าเพิ่งแพ็ค ให้แจ้งแอดมิน</p>
      </div>`;
    $("#packResult").scrollIntoView({ behavior: "smooth", block: "start" });
    lastCode = "";
    setTimeout(resumeScan, 1200);
  }

  function renderResult(scroll) {
    const o = current;
    const box = $("#packResult");
    if (!o) { box.innerHTML = ""; return; }
    const done = !!o.packedBy;
    const allTicked = o.items.length > 0 && ticked.size === o.items.length;
    const totalSheets = o.items.reduce((a, b) => a + (Number(b.qty) || 0), 0);
    const isNote = (it) => it.code === "!";
    const partial = o.items.some(isNote);
    const realCount = o.items.filter((it) => !isNote(it)).length;
    box.innerHTML = `
      <div class="card pack-card ${done ? "warn" : ""}">
        ${done ? `<div class="pack-banner warn">⚠️ กล่องนี้แพ็คไปแล้ว โดย <b>${esc(o.packedBy)}</b> · ${esc(timeTH(o.packedAt))}</div>` : ""}
        ${partial && !done ? `<div class="pack-banner warn">⚠️ <b>ใบปะแสดงสินค้าไม่ครบ</b> ด้านล่างคือรายการที่อ่านได้เท่านั้น เปิดคำสั่งซื้อ <b>${esc(o.orderId)}</b> ในระบบ แล้วหยิบที่เหลือให้ครบ</div>` : ""}
        <div class="row-between">
          <div>
            <div class="pack-track">${esc(o.tracking)}</div>
            <div class="muted pack-order">Order ${esc(o.orderId)}</div>
          </div>
          <div class="pack-total">${realCount}${partial ? "+" : ""} รายการ<br /><b>${totalSheets}${partial ? "+" : ""}</b> แผ่น</div>
        </div>
        <div class="pack-hint-row">
          <p class="hint">${done ? "ไม่ต้องแพ็คซ้ำ ถ้าบันทึกผิดกด “ยกเลิกการแพ็ค”" : "หยิบของทีละรายการ แล้วแตะเพื่อติ๊ก"}</p>
          ${done || !o.items.length ? "" : `<button class="btn small ghost" id="packTickAll" type="button">${allTicked ? "ยกเลิกติ๊กทั้งหมด" : "☑️ ติ๊กทุกข้อ"}</button>`}
        </div>
        <ul class="pack-items">
          ${o.items.map((it, i) => { const c = colorOf(it); return `
            <li>
              <button type="button" class="pack-item ${isNote(it) ? "note" : ""} ${c ? "colored" : ""} ${ticked.has(i) || done ? "on" : ""}" data-i="${i}" ${done ? "disabled" : ""}${c ? ` style="--item-bg:${c.bg};--item-fg:${c.fg}"` : ""}>
                ${codeBox(it)}
                <span class="pack-sku">${c ? `<span class="pack-color">สี${esc(c.name)}</span>` : ""}<b>${esc(skuOf(it) || "-")}</b><span class="muted">${esc(it.name)}</span></span>
                ${isNote(it) ? `<span class="pack-qty">?<small>ดูในระบบ</small></span>` : `<span class="pack-qty">×${esc(it.qty)}<small>แผ่น</small></span>`}
                <span class="pack-check" aria-hidden="true"></span>
              </button>
            </li>`; }).join("")}
        </ul>
        ${done
          ? `<div class="dialog-actions"><button class="btn ghost" id="packNext" type="button">สแกนกล่องถัดไป</button><button class="btn danger" id="packUndo" type="button">ยกเลิกการแพ็ค</button></div>`
          : `<button class="btn primary full big" id="packDone" type="button" ${allTicked ? "" : "disabled"}>${allTicked ? "✅ ครบแล้ว บันทึกการแพ็ค" : `ติ๊กให้ครบก่อน (${ticked.size}/${o.items.length})`}</button>
             <button class="btn ghost full pack-skip" id="packCancel" type="button">ยังไม่แพ็คกล่องนี้ สแกนกล่องอื่น</button>`}
      </div>`;
    box.querySelectorAll("[data-zoom]").forEach((z) => {
      const go = (e) => { e.stopPropagation(); e.preventDefault(); openZoom(z.dataset.zoom, z.dataset.name); };
      z.addEventListener("click", go);
      z.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") go(e); });
    });
    box.querySelectorAll(".pack-item").forEach((b) =>
      b.addEventListener("click", () => {
        const i = Number(b.dataset.i);
        ticked.has(i) ? ticked.delete(i) : ticked.add(i);
        renderResult();
      })
    );
    const btnAll = $("#packTickAll");
    if (btnAll) btnAll.addEventListener("click", () => {
      // ติ๊กทุกข้อไม่รวมแถวเตือน "ใบปะไม่ครบ" ต้องกดยืนยันเองหลังเช็คในระบบ
      ticked = allTicked ? new Set() : new Set(o.items.map((it, i) => (it.code === "!" ? -1 : i)).filter((i) => i >= 0));
      renderResult();
    });
    const btnDone = $("#packDone");
    if (btnDone) btnDone.addEventListener("click", confirmPacked);
    const btnUndo = $("#packUndo");
    if (btnUndo) btnUndo.addEventListener("click", undoPacked);
    const btnNext = $("#packNext");
    if (btnNext) btnNext.addEventListener("click", () => { current = null; renderResult(); startScan(); });
    const btnCancel = $("#packCancel");
    if (btnCancel) btnCancel.addEventListener("click", () => { current = null; renderResult(); startScan(); });
    if (scroll) box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // บันทึกแบบไม่ต้องรอชีต: ขึ้นว่าบันทึกแล้วทันที แล้วส่งขึ้นชีตเบื้องหลัง (ส่งไม่ผ่านจะเก็บไว้ส่งใหม่)
  const LS_QUEUE = "pack_queue_v1";
  let queue = [];
  try { queue = JSON.parse(localStorage.getItem(LS_QUEUE)) || []; } catch {}
  let flushing = false;
  const saveQueue = () => { try { localStorage.setItem(LS_QUEUE, JSON.stringify(queue)); } catch {} };

  async function flushQueue() {
    if (flushing || !queue.length) return;
    flushing = true;
    try {
      while (queue.length) {
        const job = queue[0];
        let res;
        try {
          res = await post({ action: "pack_done", tracking: job.tracking, by: job.by });
        } catch (err) {
          if (/ไม่พบเลขพัสดุ/.test(err.message)) { queue.shift(); saveQueue(); continue; }
          setTimeout(flushQueue, 8000);
          break;
        }
        queue.shift();
        saveQueue();
        if (res.already && res.packedBy !== job.by) {
          const o = orders.find((x) => x.tracking === job.tracking);
          if (o) { o.packedBy = res.packedBy; o.packedAt = res.packedAt; }
          toast(`⚠️ ${job.tracking} ถูก ${res.packedBy} บันทึกไปก่อนแล้ว`);
          renderProgress();
        }
      }
    } finally {
      flushing = false;
    }
  }

  function confirmPacked() {
    if (needEmployee() || !current) return;
    const o = current;
    o.packedBy = employee;
    o.packedAt = new Date().toISOString();
    queue.push({ tracking: o.tracking, by: employee });
    saveQueue();
    flushQueue();
    current = null;
    renderResult();
    renderProgress();
    toast(`✅ บันทึกแล้ว ${o.tracking}`);
    if (cameraWanted) resumeScan();
    else $("#packInput").focus();
  }

  async function undoPacked() {
    const o = current;
    if (!o || !confirm(`ยกเลิกการแพ็คของ ${o.tracking} (บันทึกโดย ${o.packedBy}) ใช่มั้ย?`)) return;
    try {
      await post({ action: "pack_undo", tracking: o.tracking, by: employee });
      o.packedBy = "";
      o.packedAt = "";
      ticked = new Set();
      renderResult();
      renderProgress();
      toast("ยกเลิกแล้ว แพ็คใหม่ได้เลย");
    } catch (err) {
      toast("ยกเลิกไม่สำเร็จ: " + err.message);
    }
  }

  // ---------------- progress ----------------
  function renderProgress() {
    const box = $("#packProgress");
    if (!API) { box.innerHTML = `<p class="hint">ยังไม่ได้ตั้งค่า Google Sheet</p>`; return; }
    const today = new Date();
    const pending = orders.filter((o) => !o.packedBy);
    const doneToday = orders.filter((o) => sameDay(o.packedAt, today));
    const mine = doneToday.filter((o) => o.packedBy === employee).length;
    box.innerHTML = `
      <div class="pack-stats">
        <div><b>${pending.length}</b><span>รอแพ็ค</span></div>
        <div><b>${doneToday.length}</b><span>แพ็ควันนี้</span></div>
        <div><b>${mine}</b><span>${employee ? esc(employee) + " แพ็ค" : "ของฉัน"}</span></div>
      </div>
      ${pending.length ? `
        <details class="pack-pending" ${wide() ? "open" : ""}>
          <summary>ดูกล่องที่ยังไม่ได้แพ็ค (${pending.length})</summary>
          <ul>${pending
            .slice()
            .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt))
            .map((o) => `<li><button type="button" data-t="${esc(o.tracking)}">${esc(o.tracking)}</button><span class="muted">${o.items.map((it) => (it.code === "!" ? "⚠️ ไม่ครบ" : esc(it.code || "?") + "×" + esc(it.qty))).join(", ")}</span></li>`)
            .join("")}</ul>
        </details>` : `<p class="hint">ไม่มีกล่องค้างแพ็ค 🎉</p>`}
      ${doneToday.length ? `
        <details class="pack-pending pack-done-list" ${wide() ? "open" : ""}>
          <summary>แพ็คแล้ววันนี้ (${doneToday.length})</summary>
          <ul>${doneToday
            .slice()
            .sort((a, b) => b.packedAt.localeCompare(a.packedAt))
            .map((o) => `<li><button type="button" data-t="${esc(o.tracking)}">${esc(o.tracking)}</button><span>${esc(o.packedBy)} · ${esc(timeTH(o.packedAt))}</span><span class="muted">${o.items.map((it) => (it.code === "!" ? "⚠️ ไม่ครบ" : esc(it.code || "?") + "×" + esc(it.qty))).join(", ")}</span></li>`)
            .join("")}</ul>
        </details>` : ""}`;
    box.querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", () => lookup(b.dataset.t)));
  }

  // ---------------- upload PDF ----------------
  async function readPdf(file) {
    const prev = $("#packPreview");
    prev.innerHTML = `<p class="hint">กำลังอ่านไฟล์…</p>`;
    try {
      await loadScript(PDFJS + "pdf.min.js");
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js";
      const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      parsed = await window.PackParse.parsePdf(doc);
      renderPreview();
    } catch (err) {
      parsed = null;
      prev.innerHTML = `<p class="pack-warn">อ่านไฟล์ไม่สำเร็จ: ${esc(err.message || err)}</p>`;
    }
  }

  function renderPreview() {
    const prev = $("#packPreview");
    const { orders: list, warnings } = parsed;
    const known = new Set(orders.map((o) => o.tracking));
    const fresh = list.filter((o) => !known.has(o.tracking));
    prev.innerHTML = `
      <p><b>อ่านได้ ${list.length} กล่อง</b>${list.length - fresh.length ? ` <span class="muted">(${list.length - fresh.length} กล่องมีในระบบแล้ว จะข้ามไป)</span>` : ""}</p>
      ${warnings.length ? `<div class="pack-warn">⚠️ ต้องเช็คด้วยตา:<ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
      <div class="table-wrap"><table class="sum-table pack-table">
        <thead><tr><th>เลขพัสดุ</th><th>รายการ</th><th>แผ่น</th></tr></thead>
        <tbody>${list.map((o) => `
          <tr class="${known.has(o.tracking) ? "zero" : ""}">
            <td>${esc(o.tracking)}</td>
            <td>${o.items.map((it) => (it.code === "!" ? `<b class="pack-note-text">⚠️ ใบปะไม่ครบ ดูที่เหลือในระบบ</b>` : `${esc(skuOf(it))} ×${esc(it.qty)}`)).join("<br />")}</td>
            <td>${o.qty}${o.incomplete ? "+" : ""}</td>
          </tr>`).join("")}</tbody>
      </table></div>
      <button class="btn primary full" id="packUpload" type="button" ${fresh.length ? "" : "disabled"}>
        ${fresh.length ? `ส่งขึ้นระบบ ${fresh.length} กล่อง` : "ไม่มีกล่องใหม่"}
      </button>`;
    const btn = $("#packUpload");
    btn.addEventListener("click", async () => {
      if (needEmployee()) return;
      btn.disabled = true;
      btn.textContent = "กำลังส่ง…";
      try {
        const res = await post({ action: "pack_upload", by: employee, orders: fresh });
        toast(`ส่งแล้ว ${res.added} กล่อง` + (res.skipped ? ` (ข้าม ${res.skipped})` : ""));
        parsed = null;
        $("#packPreview").innerHTML = `<p class="hint">✅ ส่งขึ้นระบบแล้ว ${res.added} กล่อง เริ่มแพ็คได้เลย</p>`;
        $("#packFile").value = "";
        await pull();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = `ส่งขึ้นระบบ ${fresh.length} กล่อง`;
        toast("ส่งไม่สำเร็จ: " + err.message);
      }
    });
  }

  // จอคอม: เปิดส่วนอัปโหลดและรายการไว้เลย
  function wide() {
    return window.matchMedia("(min-width: 900px)").matches;
  }

  // ---------------- ค้นหาว่าใครแพ็ค ----------------
  const normId = (v) => String(v || "").replace(/^'/, "").replace(/\s+/g, "").toUpperCase();

  function findCard(o) {
    const items = (o.items || []).map((it) => `${esc(skuOf(it) || it.name)} ×${Number(it.qty) || 0}`).join(", ");
    const who = o.packedBy
      ? `<b class="find-who">✅ ${esc(o.packedBy)}</b> <span class="muted">แพ็คเมื่อ ${esc(timeTH(o.packedAt))}</span>`
      : `<b class="find-who pending">⏳ ยังไม่มีคนแพ็ค</b>${o.cleared ? ` <span class="muted">(ล้างออกจากรายการรอแพ็คแล้ว)</span>` : ""}`;
    return `<li>
      <div>${who}</div>
      <div class="find-ids">คำสั่งซื้อ <b>${esc(o.orderId || "-")}</b> · พัสดุ ${esc(o.tracking)}</div>
      ${items ? `<div class="muted find-items">${items}${o.qty ? ` (รวม ${o.qty} แผ่น)` : ""}</div>` : ""}
      ${o.uploadedAt ? `<div class="muted find-items">อัปใบปะ ${esc(timeTH(o.uploadedAt))}${o.uploadedBy ? ` โดย ${esc(o.uploadedBy)}` : ""}</div>` : ""}
    </li>`;
  }

  function showFind(list, note) {
    const box = $("#packFindResult");
    if (!list.length) { box.innerHTML = `<p class="pack-warn">ไม่พบเลขนี้${note ? "<br>" + note : ""}</p>`; return; }
    box.innerHTML = `<ul class="pack-find-list">${list.map(findCard).join("")}</ul>${note ? `<p class="hint">${note}</p>` : ""}`;
  }

  async function findPacker(raw) {
    const q = normId(raw);
    const box = $("#packFindResult");
    if (q.length < 4) { box.innerHTML = `<p class="pack-warn">พิมพ์อย่างน้อย 4 ตัว</p>`; return; }
    // ค้นในรายการที่โหลดไว้แล้วก่อน (14 วันล่าสุด) ให้เห็นผลทันที
    const local = orders.filter((o) => normId(o.tracking).includes(q) || normId(o.orderId).includes(q)).slice(0, 20);
    if (local.length) showFind(local, "กำลังค้นย้อนหลังทั้งหมด…");
    else box.innerHTML = `<p class="muted">กำลังค้นหา…</p>`;
    try {
      const res = await fetch(`${API}?action=pack_search&q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!Array.isArray(data.results)) throw new Error("old");
      if (normId($("#packFindInput").value) !== q) return; // พิมพ์เลขใหม่ไปแล้ว
      // คิวที่บันทึกในเครื่องแต่ยังส่งไม่ถึงชีต
      for (const o of data.results) {
        const job = !o.packedBy && queue.find((j) => j.tracking === o.tracking);
        if (job) { o.packedBy = job.by; o.packedAt = new Date().toISOString(); }
      }
      showFind(data.results);
    } catch (err) {
      showFind(local, err.message === "old"
        ? "ค้นได้แค่ 14 วันล่าสุด — ต้องอัปเดตโค้ด Apps Script ก่อน ถึงจะค้นย้อนหลังทั้งหมดได้"
        : "ค้นย้อนหลังไม่สำเร็จ (เน็ต?) แสดงเฉพาะ 14 วันล่าสุด");
    }
  }

  // ---------------- init ----------------
  renderEmployees();
  if (wide()) $("#packAdmin").open = true;
  $("#packScanBtn").addEventListener("click", startScan);
  $("#packStopBtn").addEventListener("click", () => stopScan());
  // สลับไปแอพอื่น/ล็อกจอ → ปิดกล้องทันที (เปิดใหม่ตอนสแกนกล่องถัดไป)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && scanner) stopScan(true);
  });
  $("#packManual").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#packInput").value.trim();
    if (v) lookup(v);
  });
  $("#packRefresh").addEventListener("click", () => pull(true));
  $("#packFind").addEventListener("submit", (e) => {
    e.preventDefault();
    $("#packFindInput").blur();
    findPacker($("#packFindInput").value);
  });
  $("#packFile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) readPdf(f);
  });
  window.addEventListener("viewchange", (e) => {
    if (e.detail === "pack") {
      preloadScanner();
      flushQueue();
      renderEmployees();
      pull();
    } else if (scanner || cameraWanted) stopScan();
  });
})();
