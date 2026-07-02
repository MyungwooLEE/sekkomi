/**
 * 세꼼(Sekkom) 리드/설문 서버 저장 — Netlify Blobs
 * ────────────────────────────────────────────
 * 프론트가 설문 제출·무료 이메일 남길 때 호출. 브라우저(localStorage) 대신 서버에 영속 저장.
 *
 * 호출: POST /api/save-lead
 * body: { kind: "survey" | "free_email", record: {...} }
 *   - survey     : 베타 설문 응답 전체(만족도·구매의향·세무사연결·이메일·주소·세금 등)
 *   - free_email : 결과 화면 무료 이메일 리드 (email, address, tax, scenarios)
 *
 * 저장소: Blobs store "seggom-leads", key = "<ts>-<rand>", value = JSON.
 * 조회는 list-leads.js(관리자 토큰 보호)에서.
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

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors() });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }
  const { kind, record } = body || {};
  if (kind !== "survey" && kind !== "free_email") return json(400, { error: "invalid kind" });
  if (!record || typeof record !== "object") return json(400, { error: "no record" });

  // 과도한 페이로드 차단(스팸/남용)
  const raw = JSON.stringify(record);
  if (raw.length > 8000) return json(413, { error: "too large" });

  const ts = Date.now();
  const id = ts + "-" + Math.random().toString(36).slice(2, 8);
  const entry = {
    id, kind, ts,
    ua: (req.headers.get("user-agent") || "").slice(0, 200),
    ip: req.headers.get("x-nf-client-connection-ip") || "",
    ...record,
  };
  try {
    await getStore("seggom-leads").set(id, JSON.stringify(entry));
    return json(200, { ok: true, id });
  } catch (e) {
    return json(502, { error: String(e.message || e) });
  }
};
