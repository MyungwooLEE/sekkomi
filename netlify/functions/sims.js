/**
 * 세꼼(Sekkom) 저장 시뮬레이션 동기화 — Netlify Blobs
 * ────────────────────────────────────────────
 * 사용자가 마이페이지에 저장한 시뮬레이션을 개인 복원키(syncId)로 서버에 보관.
 * 다른 기기/브라우저에서 결과 메일 링크(?r=...&syncId 포함)로 열면 그대로 복원돼요.
 *
 *   GET  /api/sims?sid=<syncId>          → { ok, sims:[...] }
 *   POST /api/sims { syncId, snap }      → 저장(append, 최대 50개)
 *   POST /api/sims { syncId, delTs }     → 해당 ts 항목 삭제
 *
 * syncId는 클라이언트가 만든 무작위 문자열(추측 불가) → 링크를 가진 본인만 접근.
 * 저장소: Blobs store "seggom-leads", key = "sim-<syncId>", value = JSON 배열.
 */
import { getStore } from "@netlify/blobs";

const cors = () => ({
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": process.env.ALLOW_ORIGIN || "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
});
const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: cors() });
const valid = (sid) => typeof sid === "string" && /^[a-zA-Z0-9_-]{6,64}$/.test(sid);
const KEY = (sid) => "sim-" + sid;

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors() });
  const store = getStore("seggom-leads");
  const url = new URL(req.url);

  if (req.method === "GET") {
    const sid = url.searchParams.get("sid") || "";
    if (!valid(sid)) return json(400, { error: "bad sid" });
    let arr = [];
    try { arr = JSON.parse((await store.get(KEY(sid))) || "[]"); } catch {}
    return json(200, { ok: true, sims: Array.isArray(arr) ? arr : [] });
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }
    const { syncId, snap, delTs } = body || {};
    if (!valid(syncId)) return json(400, { error: "bad sid" });
    const k = KEY(syncId);
    let arr = [];
    try { arr = JSON.parse((await store.get(k)) || "[]"); } catch {}
    if (!Array.isArray(arr)) arr = [];

    if (delTs != null) {
      arr = arr.filter((x) => x && x.ts !== delTs);
    } else if (snap && typeof snap === "object") {
      const s = Object.assign({}, snap);
      if (!s.ts) s.ts = Date.now();
      if (JSON.stringify(s).length > 3000) return json(413, { error: "too large" });
      arr = arr.filter((x) => x && x.ts !== s.ts);
      arr.unshift(s);
      arr = arr.slice(0, 50);
    } else {
      return json(400, { error: "no snap" });
    }
    await store.set(k, JSON.stringify(arr));
    return json(200, { ok: true, count: arr.length });
  }

  return json(405, { error: "method not allowed" });
};
