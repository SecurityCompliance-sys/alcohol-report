# ระบบรายงานผลตรวจแอลกอฮอล์เป็นบวก — คู่มือติดตั้ง (SETUP GUIDE)

BevChain Security & Compliance · เอกสารลับ ใช้ภายในเท่านั้น

---

## 1. สถาปัตยกรรม

```
┌────────────────┐   POST (text/plain)   ┌───────────────────┐   POST (json)    ┌────────────────────┐
│ alcohol-report │ ────────────────────▶ │ Cloudflare Worker │ ───────────────▶ │  Power Automate     │
│ .html (Pages)  │   token เบา + payload  │ (ซ่อน URL+secret)  │  secret จริง     │  Flow (intake)      │
└────────────────┘                        └───────────────────┘                  └─────────┬──────────┘
        ▲  รูป → Cloudinary (unsigned)                                                       │
        │                                                              ┌──────────────┬──────┴───────┐
┌────────────────┐  จัดการ config/routing/รายงาน                       ▼              ▼              ▼
│  admin.html    │                                            SharePoint      Send email       (ทางเลือก)
│  (Pages)       │                                            _SiteRouting     ผู้จัดการไซต์      Supabase
└────────────────┘                                            + _Log                            (Live Viewer)
```

> **ถ้ายังไม่ทำ Worker (ทางลัด):** ฟอร์มยิงเข้า Power Automate ตรงๆ ได้ แต่ URL+token จะอยู่ในหน้าเว็บ (กึ่งเปิดเผย) — แนะนำทำ Worker เพื่อความปลอดภัย

---

## 2. รายการไฟล์ (ผลิตครบแล้ว ✅)

| ไฟล์ | หน้าที่ |
|------|---------|
| `index.html` | ฟอร์มให้ รปภ. กรอก — เปิดที่ลิงก์สั้น `…/alcohol-report/` (deploy บน GitHub Pages) |
| `alcohol-report.html` | redirect ไปหน้าฟอร์ม (รองรับลิงก์เก่า) |
| `admin.html` | คอนโซลคุมระบบ (config/routing/รายงาน/security) |
| `worker.js` | Cloudflare Worker คั่นกลางซ่อน secret |
| `sharepoint-setup.ps1` | สคริปต์สร้าง SharePoint lists |
| `email-template.html` | เทมเพลตอีเมลแจ้งเตือน (วางใน Send Email) |
| `supabase-setup.sql` | (ทางเลือก) ตาราง + RLS สำหรับ Live Viewer |
| `SETUP-GUIDE.md` | ไฟล์นี้ |

---

## 3. สิ่งที่ต้อง "ไป setup ในระบบภายนอก" (ทำลำดับสุดท้าย)

ทำตามลำดับนี้ — ทุกอย่างข้างบนเป็นโค้ด/สคริปต์พร้อมแล้ว เหลือแค่กดตั้งค่า

### ขั้น A — Cloudinary
- สร้าง **unsigned upload preset** ชื่อ `alcohol_report`
- Settings → Upload: จำกัด **Allowed formats** = `jpg,png`, ตั้ง **Max file size**, เปิดโฟลเดอร์ `alcohol_reports`

### ขั้น B — SharePoint
- `Connect-PnPOnline` เข้าไซต์ S&C แล้วรัน `sharepoint-setup.ps1`
- ได้ 2 lists → **จำกัดสิทธิ์เข้าถึง** (PDPA)
- ใน `admin.html` แท็บ 🗂️ กรอกอีเมลผู้จัดการ → **Export CSV** → นำเข้า `AlcoholTest_SiteRouting`

### ขั้น C — Power Automate Flow (ดูตารางข้อ 4)
- สร้าง flow → ได้ **Trigger URL**
- **ถ้าใช้ Worker:** เอา URL นี้ไปเป็น secret `FLOW_URL` ของ Worker (ไม่ใส่ในฟอร์ม)
- **ถ้าไม่ใช้ Worker:** เอา URL นี้ไปใส่ `admin.html` → สร้าง CONFIG → วางในฟอร์ม

### ขั้น D — Cloudflare Worker (แนะนำ)
```
npm i -g wrangler && wrangler login
wrangler secret put FLOW_URL       # URL จาก Power Automate
wrangler secret put FLOW_SECRET    # โทเค็นที่ flow ตรวจ
wrangler secret put CLIENT_TOKEN   # โทเค็นเบาที่ browser ส่ง
wrangler deploy
```
- แก้ `ALLOWED_ORIGINS` ใน `worker.js` เป็นโดเมน Pages ของคุณ
- เอา **URL ของ Worker** → `admin.html` ช่อง Webhook, และตั้ง Token = `CLIENT_TOKEN`
- ⚠️ **CSP:** ฟอร์มอนุญาต `https://*.workers.dev` ใน `connect-src` ให้แล้ว — ถ้า Worker ใช้ **custom domain** ต้องเพิ่มโดเมนนั้นใน `<meta http-equiv="Content-Security-Policy">` ของ `index.html` ด้วย ไม่งั้น browser จะบล็อกการส่งเงียบๆ

### ขั้น E — ประกอบฟอร์ม + Deploy
- `admin.html` → **สร้าง CONFIG block** → วางแทน `const CONFIG = {…}` ใน `index.html`
- อัป `index.html` + `admin.html` ขึ้น repo → เปิด GitHub Pages
- (ทางเลือก) รัน `supabase-setup.sql` + ต่อ Auth ถ้าจะใช้ Live Viewer

---

## 4. Power Automate — Build Sheet

Flow: **"Alcohol Report · Intake & Notify"**

| # | Action | ตั้งค่า / Expression |
|---|--------|----------------------|
| 1 | **When a HTTP request is received** | Method: `POST` → บันทึกเพื่อรับ URL |
| 2 | **Parse JSON** | Content: `json(string(triggerBody()))` · Schema: ดูข้อ 5 |
| 3 | **Condition** (ตรวจโทเค็น) | `body('Parse_JSON')?['token']` **is equal to** `<FLOW_SECRET>` |
| 3a| ‑ ถ้า **No** | **Response** 401 → **Terminate** (status: Failed) |
| 4 | **Get items** (SharePoint) | List `AlcoholTest_SiteRouting` · Filter Query: `Title eq '@{body('Parse_JSON')?['site']}'` · Top Count `1` |
| 5 | **Compose** `mgr` | `first(body('Get_items')?['value'])?['ManagerEmail']` |
| 5b| **Compose** `cc` | `first(body('Get_items')?['value'])?['CCEmail']` |
| 6 | **Send an email (V2)** | To `@{outputs('mgr')}` · CC `@{outputs('cc')}` · From (Send as) อีเมลแผนก · Importance `High` · Subject/Body: ดูล่าง |
| 7 | **Create item** (SharePoint) | List `AlcoholTest_Log` · map ฟิลด์ (Title = `caseId`) |
| 8 | **Response** | Status `200` · Body `{"status":"ok"}` |

**Subject (ข้อ 6):**
```
🚨 [ALCOHOL+] @{body('Parse_JSON')?['site']} — @{body('Parse_JSON')?['fullName']} (@{body('Parse_JSON')?['caseId']})
```
**Body (ข้อ 6):** เปิด `email-template.html` → คัดลอกทั้งหมด → วางในโหมด `</>` ของช่อง Body

**Map ข้อ 7 (Create item → AlcoholTest_Log):**
`Title`=`caseId` · `Site`=`site` · `TestDate`=`testDate` · `PersonType`=`personType` · `FullName`=`fullName` · `Company`=`company` · `LicensePlate`=`licensePlate` · `Result1`=`result1` · `Time1`=`time1` · `Result2`=`result2` · `Time2`=`time2` · `Severity`=`severity` · `PhotoUrl`=`photoUrl` · `Reporter`=`reporter` · `Notes`=`notes` · `SubmittedAt`=`submittedAt`
(ทุกตัวอ้างด้วย `body('Parse_JSON')?['ชื่อฟิลด์']`)

### ⚠️ เรื่อง CORS (สำคัญ)
- **ใช้ Worker:** Worker จัดการ CORS ให้แล้ว → Response ข้อ 8 **ไม่ต้อง**ใส่ header CORS
- **ไม่ใช้ Worker (ตรง):** Response ข้อ 8 **ต้อง**เพิ่ม header `Access-Control-Allow-Origin: https://<โดเมน Pages ของคุณ>` ไม่งั้น browser อ่านผลไม่ได้ (ฟอร์มจะขึ้น error ทั้งที่ส่งถึงแล้ว)

### โทเค็นในแต่ละเส้นทาง
- **ใช้ Worker:** browser ส่ง `CLIENT_TOKEN` → Worker ตรวจ แล้วสลับใส่ `FLOW_SECRET` → flow ข้อ 3 ตรวจ `FLOW_SECRET`
- **ไม่ใช้ Worker:** ฟอร์มส่ง `CONFIG.sharedToken` → flow ข้อ 3 ตรวจค่าเดียวกันนี้

---

## 5. Parse JSON Schema (ข้อ 2)

```json
{ "type":"object","properties":{
  "token":{"type":"string"},"caseId":{"type":"string"},"site":{"type":"string"},
  "testDate":{"type":"string"},"personType":{"type":"string"},"fullName":{"type":"string"},
  "company":{"type":"string"},"licensePlate":{"type":"string"},"result1":{"type":"string"},
  "time1":{"type":"string"},"result2":{"type":"string"},"time2":{"type":"string"},
  "severity":{"type":"string"},"photoUrl":{"type":"string"},"reporter":{"type":"string"},
  "notes":{"type":"string"},"submittedAt":{"type":"string"},"appVersion":{"type":"string"}
}}
```

---

## 6. ทดสอบ End-to-End ✅

- [ ] กรอกเคสทดสอบ → กดส่ง → ต้องขึ้น **หน้า success + เลขเคส**
- [ ] อีเมลถึงผู้จัดการไซต์ที่ถูกต้อง (ลองต่างไซต์)
- [ ] มีแถวใหม่ใน `AlcoholTest_Log` · รูปเปิดได้
- [ ] เลือก "พนักงานทั่วไป" → ช่องทะเบียนหาย + อีเมลขึ้น "— (พนักงานทั่วไป)"
- [ ] ใส่ค่าสูงกว่าเกณฑ์ → อีเมลมีแถบ "⚠️ สูงกว่าเกณฑ์"
- [ ] ปิดเน็ตแล้วส่ง → เข้า pending queue → เปิดเน็ตแล้วส่งอัตโนมัติ
- [ ] (Worker) ลองยิงจากโดเมนอื่น → ต้องโดน `forbidden_origin`

---

## 7. Security & PDPA Checklist (ก่อน go-live)

- [ ] เปลี่ยนรหัส admin (แท็บ Security → สร้าง hash → วางแทน `PW_HASH`)
- [ ] **ไม่ลิงก์หน้า admin** ในที่ public
- [ ] Deploy **Cloudflare Worker** → ซ่อน Power Automate URL + secret
- [ ] จำกัดสิทธิ์ SharePoint `_SiteRouting` + `_Log` และโฟลเดอร์ Cloudinary
- [ ] ตั้ง **retention** ให้ `_Log`/Cloudinary — ไม่เก็บเกินจำเป็น
- [ ] Cloudinary preset: จำกัด format/ขนาด เปิด moderation
- [ ] ตั้ง **rate limiting rule** ที่ Cloudflare dashboard (กัน spam)
- [ ] ถ้าใช้ Supabase: RLS ปิด anon, เขียนด้วย service role ใน Power Automate เท่านั้น, อ่านผ่าน Auth
- [ ] หมุนเวียน (rotate) `FLOW_SECRET` / `CLIENT_TOKEN` เป็นระยะ

---

## 8. ข้อจำกัดที่ยอมรับ (ทราบไว้)

- รหัสผ่าน admin = ตรวจฝั่ง client (กันคนทั่วไป ไม่กันผู้เชี่ยวชาญ) — การป้องกันจริงอยู่ที่สิทธิ์ SharePoint/Supabase
- `CLIENT_TOKEN` ยังเห็นได้ในหน้าเว็บ แต่ค่าต่ำแล้ว (secret จริงอยู่ใน Worker)
- ฟอร์มต้องกรอกเวลาแบบ 24 ชม. เลข 0 นำหน้า (เช่น `0815`)
```
