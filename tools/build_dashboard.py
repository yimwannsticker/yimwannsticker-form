"""สร้าง dashboard.html สำหรับเว็บ จากไฟล์ Sales Dashboard ตัวหลัก (HTML ของ artifact)

python3 tools/build_dashboard.py <ไฟล์ HTML ของแดชบอร์ดหลัก> [dashboard.html]

สิ่งที่ตัดออก (เว็บนี้เป็นสาธารณะ):
- ชื่อผู้ซื้อ (คอลัมน์ Buyer) ทุกแถว + การ์ด "ลูกค้าที่ซื้อมากที่สุด" + คอลัมน์ผู้ซื้อในตารางออเดอร์
- ส่วนกำไร: เงินเดือนพนักงาน ต้นทุนต่อออเดอร์ ค่า affiliate ค่าโฆษณา
สิ่งที่เพิ่ม:
- ดึงไฟล์ full_month ที่ใหม่กว่าวันที่สร้างหน้า จาก Google Drive ผ่าน Apps Script (action=dash_files) มาแทนเดือนเดิม
- ปุ่มกลับแอป
"""
import csv, io, re, sys, json, pathlib

src = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
out_path = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "dashboard.html")
cfg = pathlib.Path(__file__).resolve().parent.parent.joinpath("config.js").read_text(encoding="utf-8")
api = re.search(r'SHEET_API_URL:\s*"([^"]+)"', cfg).group(1)

# 1) ตัด wrapper ของ artifact เอาเฉพาะเอกสารด้านใน
m = re.search(r"<!doctype html>\s*<html lang", src, re.I)
if m and m.start() > 0:
    src = src[m.start():]
    end = src.rfind("</html>")
    src = src[: end + len("</html>")] + "\n"

PLATFORMS = {"Shopee", "TikTok Shop", "Line"}

def strip_buyers(text):
    out = io.StringIO()
    w = csv.writer(out, lineterminator="\n")
    for row in csv.reader(io.StringIO(text)):
        if row and row[0].strip() in PLATFORMS and len(row) > 3:
            row[3] = ""
        w.writerow(row)
    return out.getvalue()

def fix_block(mm):
    return mm.group(1) + strip_buyers(mm.group(2)) + mm.group(3)

src, n = re.subn(r'(<script type="text/plain" class="csv-src"[^>]*>)(.*?)(</script>)', fix_block, src, flags=re.S)
assert n > 0, "ไม่พบข้อมูล csv-src"

def sub1(pattern, repl, flags=re.S):
    global src
    src, k = re.subn(pattern, repl, src, count=1, flags=flags)
    assert k == 1, "หาไม่เจอ: " + pattern[:60]

# 2) ส่วนกำไร / เงินเดือน / ต้นทุน / โฆษณา
sub1(r"var STAFF_COSTS = \[.*?\];", 'var STAFF_COSTS = [{ from: "0000-00", en: "", th: "", monthly: 0 }];')
sub1(r"var ORDER_COST = \{.*?\};\n", "var ORDER_COST = {};\n")
sub1(r"var AFFILIATE = \{.*?\};\n", "var AFFILIATE = {};\n")
sub1(r"var AD_SPEND = \{.*?\};", "var AD_SPEND = {};")
sub1(r'\n\s*renderProfitCard\(document\.getElementById\("profitCard"\), finalRows, periodRows\);', "")

# 3) ลูกค้า
sub1(r"""\s*'<div class="card"><h2>' \+ tr\("Top customers".*?</div>' \+""", "")
sub1(r'\n\s*renderBuyerTable\(document\.getElementById\("buyerTable"\), topBuyers\(finalRows, 10\)\);', "")
sub1(r"""'</td><td>' \+ escapeHtml\(r\.buyer\) \+ '</td><td>'""", """'</td><td>'""")
sub1(r"""'</th><th>' \+ tr\("Buyer", "ผู้ซื้อ"\) \+ '</th><th>'""", """'</th><th>'""")
sub1(r"""<td colspan="4">""", """<td colspan="3">""")
sub1(r'tr\("Order ID, buyer or product", "หมายเลขคำสั่งซื้อ ชื่อผู้ซื้อ หรือสินค้า"\)', 'tr("Order ID or product", "หมายเลขคำสั่งซื้อ หรือสินค้า")')

# 4) footer + ดึงข้อมูลใหม่จาก Drive
sub1(r'document\.getElementById\("footer"\)\.innerHTML = SNAPSHOT\s*\? tr\(".*?"\)\s*:',
     'document.getElementById("footer").innerHTML = SNAPSHOT\n      ? tr("Sales figures only — customer names and profit details are not shown on this page.", "แสดงเฉพาะยอดขาย ไม่แสดงชื่อลูกค้าและรายละเอียดกำไร")\n      :')

live = """
    // ดึงไฟล์เดือนที่ใหม่กว่าหน้านี้จาก Google Drive (ไม่มีชื่อลูกค้า) แล้วแทนเดือนเดิม
    (function () {
      var API = %s;
      var since = SNAPSHOT_META.generatedAt || "";
      fetch(API + "?action=dash_files&since=" + encodeURIComponent(since)).then(function (r) { return r.json(); }).then(function (d) {
        if (!d || !d.ok || !d.files || !d.files.length) return;
        var monthOf = function (rows) { return rows.length ? rows[0].day.slice(0, 7) : ""; };
        d.files.forEach(function (f) {
          var rows = parseCsvText(f.text, f.name);
          if (!rows.length) return;
          var mo = monthOf(rows);
          Object.keys(state.files).forEach(function (k) { if (monthOf(state.files[k].rows) === mo) delete state.files[k]; });
          state.files["drive:" + f.name] = { rows: rows };
          if (f.updated && f.updated > (SNAPSHOT_META.generatedAt || "")) SNAPSHOT_META.generatedAt = f.updated;
        });
        render();
      }).catch(function () {});
    })();
""" % json.dumps(api)
sub1(r"(if \(SNAPSHOT\) \{\n\s*Array\.prototype\.forEach\.call\(document\.querySelectorAll\(\"script\.csv-src\"\).*?\}\);\n\s*render\(\);)",
     lambda mm: mm.group(1) + live)

# 5) ปุ่มกลับแอป
sub1(r'(<div class="topbar-actions">)', r'\1\n      <a class="btn ghost small" href="./" style="text-decoration:none">← กลับแอป</a>')

for bad in ("12,000 + 9,000", "monthly: 30000", "monthly: 12000"):
    assert bad not in src, "ยังมีข้อมูลเงินเดือน: " + bad
out_path.write_text(src, encoding="utf-8")
print("wrote", out_path, len(src), "bytes;", n, "data blocks")
