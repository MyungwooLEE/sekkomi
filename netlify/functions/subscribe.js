/**
 * 세꼼(Sekkom) 세법 변경 알림 구독 — Netlify Blobs
 * ────────────────────────────────────────────
 * 블로그 글 하단 구독 블록에서 호출. 이메일 1개를 받아 서버에 영속 저장.
 * ([K] 구독 루프 1단계, 2026-08-05. 저장 방식·코드 관례는 save-lead.js를 따름)
 *
 * 호출: POST /api/subscribe
 * body: { email: "...", source: "blog:<slug>" }
 *
 * 저장소: Blobs store "seggom-subscribers", key = 정규화된 이메일(중복 구독 시 갱신), value = JSON.
 * 콜드 아웃리치 주소는 절대 이 목록에 넣지 않는다 — 이 함수는 본인 제출만 받는다.
 * 수신거부: 안내 메일의 회신 또는 문의 주소로 접수 → 관리자가 삭제.
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
const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: cors() });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors() });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }
  const email = String((body && body.email) || "").trim().toLowerCase();
  const source = String((body && body.source) || "").slice(0, 120);
  if (!EMAIL_RE.test(email) || email.length > 254) return json(400, { error: "invalid email" });

  const store = getStore("seggom-subscribers");
  const ts = Date.now();
  try {
    const prev = await store.get(email);
    if (prev) {
      // 이미 구독 중 — 최근 source만 덧붙이고 성공 응답 (중복 키 생성 금지)
      const entry = JSON.parse(prev);
      entry.last_ts = ts;
      if (source && entry.source !== source) entry.last_source = source;
      await store.set(email, JSON.stringify(entry));
      return json(200, { ok: true, already: true });
    }
    const entry = {
      email, source, ts,
      ua: (req.headers.get("user-agent") || "").slice(0, 200),
      ip: req.headers.get("x-nf-client-connection-ip") || "",
    };
    await store.set(email, JSON.stringify(entry));
    return json(200, { ok: true });
  } catch (e) {
    return json(502, { error: String(e.message || e) });
  }
};
