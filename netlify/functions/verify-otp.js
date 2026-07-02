/**
 * 세꼼(Sekkom) OTP 검증 함수
 * 호출: POST /.netlify/functions/verify-otp
 * body: { to: "user@x.com", code: "123456" }
 * 응답: { ok: true } 또는 { ok:false, error }
 *
 * 검증 성공 시 해당 코드를 즉시 삭제(1회용). 5분 만료. 5회 시도 제한.
 */
import { getStore } from "@netlify/blobs";

function cors() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": process.env.ALLOW_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors() });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: cors() });

  let p; try { p = await req.json(); } catch { return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers: cors() }); }
  const { to, code } = p || {};
  if (!to || !code) return new Response(JSON.stringify({ ok: false, error: "이메일·코드 누락" }), { status: 400, headers: cors() });

  const store = getStore("seggom-otp");
  const raw = await store.get("otp:" + to);
  if (!raw) return new Response(JSON.stringify({ ok: false, error: "인증번호를 다시 요청해주세요" }), { status: 400, headers: cors() });

  const rec = JSON.parse(raw);
  if (Date.now() > rec.exp) {
    await store.delete("otp:" + to);
    return new Response(JSON.stringify({ ok: false, error: "인증번호가 만료됐어요(5분). 다시 요청해주세요" }), { status: 400, headers: cors() });
  }
  rec.tries = (rec.tries || 0) + 1;
  if (rec.tries > 5) {
    await store.delete("otp:" + to);
    return new Response(JSON.stringify({ ok: false, error: "시도 횟수를 초과했어요. 다시 요청해주세요" }), { status: 429, headers: cors() });
  }
  if (String(code) !== String(rec.code)) {
    await store.set("otp:" + to, JSON.stringify(rec)); // 시도 횟수 갱신
    return new Response(JSON.stringify({ ok: false, error: "인증번호가 일치하지 않아요" }), { status: 400, headers: cors() });
  }
  await store.delete("otp:" + to); // 1회용 — 성공 즉시 폐기
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors() });
};
