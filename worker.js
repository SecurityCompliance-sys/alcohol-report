/* ============================================================================
   worker.js — BevChain · Alcohol Report secure proxy (Cloudflare Workers)
   ----------------------------------------------------------------------------
   หน้าที่: ซ่อน Power Automate URL + secret จริง ไม่ให้หลุดไปที่ browser
            Browser → (Worker นี้) → Power Automate

   ทำไมต้องมี: URL ของ Power Automate มี ?sig=... ต่อท้าย ใครได้ URL ก็ยิงได้
              การฝัง URL+token ไว้ในฟอร์มบนเว็บ public = กึ่งเปิดเผย
              Worker เก็บ URL+secret จริงไว้ฝั่ง server → client เห็นแค่ Worker URL

   Deploy:
     1) npm i -g wrangler   แล้ว   wrangler login
     2) ตั้ง secrets (ไม่ hardcode ในโค้ด):
          wrangler secret put FLOW_URL       # URL จริงจาก Power Automate trigger
          wrangler secret put FLOW_SECRET    # โทเค็นที่ "flow" ตรวจ (อยู่ฝั่ง server เท่านั้น)
          wrangler secret put CLIENT_TOKEN   # โทเค็นเบาที่ "browser" ส่งมา
     3) wrangler deploy
     4) เอา URL ของ Worker ไปใส่ CONFIG.webhookUrl ในฟอร์ม
        และตั้ง CONFIG.sharedToken = ค่าเดียวกับ CLIENT_TOKEN
   ============================================================================ */

// ⬇️ แก้เป็นโดเมน GitHub Pages ของคุณ (ล็อกไม่ให้เว็บอื่นเรียก Worker)
const ALLOWED_ORIGINS = [
  "https://brfsecurityandcompliance.github.io"
];
const MAX_BYTES = 20000; // กันยิง payload ใหญ่ผิดปกติ

// ฟิลด์ที่อนุญาตให้ forward + ความยาวสูงสุดต่อฟิลด์ — ฟิลด์อื่นนอกลิสต์ถูกทิ้ง
const FIELD_MAX = {
  caseId: 40, site: 60, testDate: 10, personType: 12, fullName: 120,
  company: 120, licensePlate: 30, result1: 12, time1: 5, result2: 12,
  time2: 5, severity: 12, photoUrl: 300, reporter: 120, notes: 600,
  submittedAt: 40, userAgent: 200, appVersion: 20
};

// sanitize ฝั่ง server — client sanitize ถูก bypass ได้โดยยิงตรงเข้า Worker
// (อีเมลแจ้งเตือนแทรกค่าเหล่านี้ลง HTML แบบดิบ จึงต้องตัด <> ที่นี่ด้วย)
function clean(v, max) {
  return String(v ?? "")
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim().slice(0, max);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    // preflight
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST")    return json({ error: "method_not_allowed" }, 405, cors);

    // 1) origin allowlist
    if (ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin))
      return json({ error: "forbidden_origin" }, 403, cors);

    // 2) size guard
    const raw = await request.text();
    if (raw.length > MAX_BYTES) return json({ error: "payload_too_large" }, 413, cors);

    // 3) parse
    let payload;
    try { payload = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400, cors); }

    // 4) ด่านโทเค็นเบาจาก browser
    if (env.CLIENT_TOKEN && payload.token !== env.CLIENT_TOKEN)
      return json({ error: "invalid_token" }, 401, cors);

    // 5) schema ขั้นต่ำ กัน spam/ยิงมั่ว
    if (!payload.site || !payload.fullName || !payload.result1 || !payload.photoUrl)
      return json({ error: "missing_fields" }, 422, cors);

    // 5.1) photoUrl ต้องเป็นลิงก์ Cloudinary เท่านั้น — URL นี้กลายเป็นปุ่ม
    //      "ดูรูปหลักฐาน" ในอีเมลผู้จัดการ ถ้าไม่ล็อกโฮสต์ คนที่ถือ CLIENT_TOKEN
    //      ยิงตรงเข้า Worker แล้วสอดลิงก์ phishing ได้
    if (!/^https:\/\/res\.cloudinary\.com\//.test(String(payload.photoUrl)))
      return json({ error: "invalid_photo_url" }, 422, cors);

    if (!env.FLOW_URL || !env.FLOW_SECRET)
      return json({ error: "worker_not_configured" }, 500, cors);

    // 6) เก็บเฉพาะฟิลด์ใน FIELD_MAX + sanitize ทุกค่า แล้วสลับใส่ secret จริง
    //    forward ไป Power Automate (URL จริงซ่อนใน env)
    const forward = {};
    for (const [k, max] of Object.entries(FIELD_MAX)) forward[k] = clean(payload[k], max);
    forward.token = env.FLOW_SECRET;
    let upstream;
    try {
      upstream = await fetch(env.FLOW_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(forward)
      });
    } catch {
      return json({ error: "upstream_unreachable" }, 502, cors);
    }

    return json(
      { status: upstream.ok ? "ok" : "upstream_error", code: upstream.status, caseId: payload.caseId || null },
      upstream.ok ? 200 : 502,
      cors
    );
  }
};

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : (ALLOWED_ORIGINS[0] || "*");
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors }
  });
}
