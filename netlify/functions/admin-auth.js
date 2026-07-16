/**
 * 세꼼(Sekkom) 어드민 인증 — 이메일 OTP → 세션 쿠키
 * ────────────────────────────────────────────
 * POST /api/admin-auth  body: { action, code? }
 *   - action="request" : ADMIN_EMAIL로 6자리 OTP 발송 (60초 쿨다운, 10분 만료, 5회 시도 제한)
 *   - action="verify"  : { code } 검증 → 성공 시 세션 쿠키(seggom_admin, 7일) 발급
 *   - action="logout"  : 세션 폐기 + 쿠키 삭제
 *   - action="check"   : 현재 세션 유효 여부 { ok }
 *
 * 어드민 계정은 ADMIN_EMAIL 하나로 고정(기본 sekkomi.com@gmail.com). 이메일 입력을 받지 않으므로
 * 계정 열거·타 주소 발송이 원천 불가. 세션은 Blobs("seggom-admin")에 저장.
 */
import { getStore } from "@netlify/blobs";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "sekkomi.com@gmail.com";
const FROM = process.env.MAIL_FROM || "세꼼 <onboarding@resend.dev>";
const RESEND_API = "https://api.resend.com/emails";
const OTP_TTL = 10 * 60 * 1000;      // 10분
const SESS_TTL = 7 * 24 * 60 * 60 * 1000; // 7일
const COOKIE = "seggom_admin";

const json = (code, obj, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status: code,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });

const rand = (n) => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

export const getSession = async (req) => {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)seggom_admin=([A-Za-z0-9]+)/);
  if (!m) return null;
  const store = getStore("seggom-admin");
  const raw = await store.get("sess:" + m[1]);
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw);
    if (Date.now() > rec.exp) { await store.delete("sess:" + m[1]); return null; }
    return { token: m[1] };
  } catch { return null; }
};

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  let body; try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }
  const action = (body && body.action) || "";
  const store = getStore("seggom-admin");

  if (action === "check") {
    const s = await getSession(req);
    return json(200, { ok: !!s });
  }

  if (action === "request") {
    if (!process.env.RESEND_API_KEY) return json(500, { error: "RESEND_API_KEY not set" });
    // 60초 쿨다운
    const last = await store.get("rl");
    if (last && Date.now() - Number(last) < 60_000) return json(429, { ok: false, error: "잠시 후 다시 요청해주세요(60초)" });
    await store.set("rl", String(Date.now()));
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await store.set("otp", JSON.stringify({ code, exp: Date.now() + OTP_TTL, tries: 0 }));
    const r = await fetch(RESEND_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.RESEND_API_KEY },
      body: JSON.stringify({
        from: FROM,
        to: [ADMIN_EMAIL],
        subject: `[세꼼 어드민] 로그인 인증번호 ${code}`,
        html: `<div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px">
          <h2 style="color:#163300">세꼼 어드민 로그인</h2>
          <p>아래 인증번호를 입력해주세요. <b>10분</b> 동안 유효해요.</p>
          <div style="background:#163300;color:#9FE870;font-size:32px;font-weight:800;letter-spacing:8px;text-align:center;padding:18px;border-radius:12px">${code}</div>
          <p style="color:#8B95A1;font-size:12px;margin-top:16px">본인이 요청하지 않았다면 이 메일을 무시하세요. 계정 정보는 유출되지 않습니다.</p>
        </div>`,
      }),
    });
    if (!r.ok) return json(502, { ok: false, error: "메일 발송 실패: " + (await r.text()).slice(0, 200) });
    return json(200, { ok: true, to_hint: ADMIN_EMAIL.slice(0, 3) + "***" });
  }

  if (action === "verify") {
    const code = String((body && body.code) || "");
    const raw = await store.get("otp");
    if (!raw) return json(400, { ok: false, error: "인증번호를 먼저 요청해주세요" });
    const rec = JSON.parse(raw);
    if (Date.now() > rec.exp) { await store.delete("otp"); return json(400, { ok: false, error: "만료됐어요(10분). 다시 요청해주세요" }); }
    rec.tries = (rec.tries || 0) + 1;
    if (rec.tries > 5) { await store.delete("otp"); return json(429, { ok: false, error: "시도 초과. 다시 요청해주세요" }); }
    if (code !== String(rec.code)) { await store.set("otp", JSON.stringify(rec)); return json(400, { ok: false, error: "인증번호가 일치하지 않아요" }); }
    await store.delete("otp"); // 1회용
    const token = rand(40);
    await store.set("sess:" + token, JSON.stringify({ exp: Date.now() + SESS_TTL, at: Date.now() }));
    return json(200, { ok: true }, {
      "Set-Cookie": `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESS_TTL / 1000}`,
    });
  }

  if (action === "logout") {
    const s = await getSession(req);
    if (s) await store.delete("sess:" + s.token);
    return json(200, { ok: true }, { "Set-Cookie": `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0` });
  }

  return json(400, { error: "action은 request | verify | logout | check" });
};
