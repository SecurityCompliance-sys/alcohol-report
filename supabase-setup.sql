-- ============================================================================
-- supabase-setup.sql — ตารางเก็บรายงานสำหรับ Live Viewer / Analyst (admin dashboard)
-- ----------------------------------------------------------------------------
-- โปรเจกต์จริง: alcohol-report-live (region ap-southeast-1)
-- รันแล้วผ่าน migration "create_alcohol_reports" — ไฟล์นี้คือ source of truth ของสคีมา
--
-- ⚠️ PDPA: ตารางนี้เก็บข้อมูลส่วนบุคคล/อ่อนไหว
--    RLS "ปิด" การเข้าถึงของ anon โดยดีฟอลต์ (ปลอดภัยไว้ก่อน)
--    - เขียนข้อมูล: Power Automate ใช้ SERVICE ROLE key (bypass RLS, ฝั่ง server เท่านั้น
--      ห้ามใส่ service key ในฟอร์ม/หน้าเว็บเด็ดขาด)
--    - อ่านข้อมูล: ใช้ Supabase Auth (ผู้ล็อกอิน) เท่านั้น — ไม่เปิด anon
-- รันซ้ำได้ (idempotent) ใน Supabase → SQL Editor
-- ============================================================================

create table if not exists public.alcohol_reports (
  id             uuid primary key default gen_random_uuid(),
  "caseId"       text unique not null,                   -- กันซ้ำ: Power Automate upsert ด้วยคีย์นี้
  site           text not null,
  "testDate"     date,
  "personType"   text,                                   -- 'transport' (TRO) | 'general' (WH)
  "fullName"     text,
  company        text,                                   -- มี suffix / WH หรือ / TRO ต่อท้าย
  "licensePlate" text,
  result1        text,
  time1          text,
  result2        text,
  time2          text,
  severity       text,                                   -- 'positive' | 'elevated'
  "photoUrl"     text,                                   -- รูปครั้งที่ 1
  "photoUrl2"    text,                                   -- รูปครั้งที่ 2 (ว่างเมื่อตรวจครั้งเดียว)
  reporter       text,
  notes          text,
  "submittedAt"  text,                                   -- เวลาไทยอ่านง่ายจากฟอร์ม ("dd/mm/yyyy HH:mm น.") — เก็บเป็น text
  inserted_at    timestamptz not null default now()      -- เวลา server สำหรับ query แนวโน้ม/สัปดาห์/ชั่วโมง
);

comment on table public.alcohol_reports is 'PDPA sensitive. RLS: anon denied; authenticated read only; writes via service role (Power Automate).';

-- เปิด RLS (สำคัญ) — ไม่มี policy ให้ anon = ยิงตรงด้วย anon key อ่าน/เขียนไม่ได้
alter table public.alcohol_reports enable row level security;

-- ดัชนีช่วย query แดชบอร์ด/วิเคราะห์
create index if not exists idx_alcohol_site       on public.alcohol_reports (site);
create index if not exists idx_alcohol_testdate   on public.alcohol_reports ("testDate");
create index if not exists idx_alcohol_inserted   on public.alcohol_reports (inserted_at desc);
create index if not exists idx_alcohol_persontype on public.alcohol_reports ("personType");
create index if not exists idx_alcohol_severity   on public.alcohol_reports (severity);

-- ----------------------------------------------------------------------------
-- Policy อ่าน — เฉพาะผู้ล็อกอิน (Supabase Auth) สำหรับแดชบอร์ดเฟส 2
-- ⛔️ ห้ามสร้าง policy select ให้ role "anon" กับตารางนี้ (ข้อมูลอ่อนไหว)
-- ----------------------------------------------------------------------------
drop policy if exists "authenticated read" on public.alcohol_reports;
create policy "authenticated read"
  on public.alcohol_reports
  for select
  to authenticated
  using (true);

-- ----------------------------------------------------------------------------
-- การเขียนจาก Power Automate (หลัง "Create item" ของ SharePoint) — HTTP action:
--   Method : POST
--   URI    : {SUPABASE_URL}/rest/v1/alcohol_reports
--   Headers:
--     apikey        = {SERVICE_ROLE_KEY}
--     Authorization = Bearer {SERVICE_ROLE_KEY}
--     Content-Type  = application/json
--     Prefer        = return=minimal,resolution=merge-duplicates   -- upsert กันซ้ำด้วย caseId
--   Body (คีย์ตรงกับคอลัมน์ ดึงจาก Parse_JSON):
--     {
--       "caseId": "@{body('Parse_JSON')?['caseId']}",
--       "site": "@{body('Parse_JSON')?['site']}",
--       "testDate": "@{body('Parse_JSON')?['testDate']}",
--       "personType": "@{body('Parse_JSON')?['personType']}",
--       "fullName": "@{body('Parse_JSON')?['fullName']}",
--       "company": "@{body('Parse_JSON')?['company']}",
--       "licensePlate": "@{body('Parse_JSON')?['licensePlate']}",
--       "result1": "@{body('Parse_JSON')?['result1']}",
--       "time1": "@{body('Parse_JSON')?['time1']}",
--       "result2": "@{body('Parse_JSON')?['result2']}",
--       "time2": "@{body('Parse_JSON')?['time2']}",
--       "severity": "@{body('Parse_JSON')?['severity']}",
--       "photoUrl": "@{body('Parse_JSON')?['photoUrl']}",
--       "photoUrl2": "@{body('Parse_JSON')?['photoUrl2']}",
--       "reporter": "@{body('Parse_JSON')?['reporter']}",
--       "notes": "@{body('Parse_JSON')?['notes']}",
--       "submittedAt": "@{body('Parse_JSON')?['submittedAt']}"
--     }
-- service role bypass RLS ได้ และต้องอยู่ใน Power Automate (ฝั่ง server) เท่านั้น
-- {SUPABASE_URL} + {SERVICE_ROLE_KEY} เอาจาก Supabase → Project Settings → API
-- ============================================================================
