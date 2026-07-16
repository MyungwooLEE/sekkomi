/**
 * 세꼼(Sekkom) 관리자 데이터 삭제 — Netlify Blobs
 * ────────────────────────────────────────────
 * 인증: ① 세션 쿠키(어드민 OTP 로그인) ② ADMIN_TOKEN 토큰 — 둘 중 하나. 2단계 안전장치(preview → confirm).
 *
 * 대시보드(권장): /admin 로그인 → 대시보드에서 선택/테스트/전체 삭제 버튼.
 *
 * API:
 *   GET  /api/delete-leads?token=…&mode=preview&filter=test        미리보기
 *   GET  /api/delete-leads?token=…&mode=delete&filter=test&confirm=DELETE
 *   POST /api/delete-leads  body: { mode:"delete", keys:[id…] | filter:"test"|"all" | email | ip, confirm }
 *
 * confirm: filter=all → "DELETE-ALL", 그 외 → "DELETE".
 * ADMIN_TOKEN 미설정 시 전면 차단. 삭제는 되돌릴 수 없음.
 */
import { getStore } from "@netlify/blobs";

const TEST_EMAILS = ["mwlee4527@gmail.com", "beta-tester@example.com"];
const TEST_IPS = ["180.65.139.114"];

const json = (code, obj) =>
  new Response(JSON.stringify(obj, null, 2), {
    status: code,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const maskEmail = (e) => {
  if (!e) return "";
  const [u, d] = String(e).split("@");
  return (u || "").slice(0, 2) + "***@" + (d || "");
};

async function sessionOk(req) {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)seggom_admin=([A-Za-z0-9]+)/);
  if (!m) return false;
  try {
    const store = getStore("seggom-admin");
    const raw = await store.get("sess:" + m[1]);
    if (!raw) return false;
    const rec = JSON.parse(raw);
    if (Date.now() > rec.exp) { await store.delete("sess:" + m[1]); return false; }
    return true;
  } catch { return false; }
}

export default async (req) => {
  const url = new URL(req.url);
  const need = process.env.ADMIN_TOKEN || "";
  if (!need) return json(503, { error: "ADMIN_TOKEN not set" });
  const token = url.searchParams.get("token") || req.headers.get("x-admin-token") || "";
  const authed = token === need || (await sessionOk(req));
  if (!authed) return json(401, { error: "unauthorized" });

  // 파라미터: GET 쿼리 + POST JSON 병합
  let p = {
    mode: url.searchParams.get("mode") || "preview",
    filter: url.searchParams.get("filter") || "",
    email: (url.searchParams.get("email") || "").trim().toLowerCase(),
    ip: (url.searchParams.get("ip") || "").trim(),
    key: (url.searchParams.get("key") || "").trim(),
    confirm: url.searchParams.get("confirm") || "",
    keys: [],
  };
  if (req.method === "POST") {
    try {
      const b = await req.json();
      p = { ...p, ...b, keys: Array.isArray(b.keys) ? b.keys.filter((k) => typeof k === "string") : [] };
    } catch { return json(400, { error: "bad json" }); }
  }

  const store = getStore("seggom-leads");
  const { blobs } = await store.list();
  const keySet = new Set(p.keys && p.keys.length ? p.keys : p.key ? [p.key] : []);

  // 대상 선별
  const targets = [];
  for (const b of blobs) {
    let item = null;
    try { item = JSON.parse(await store.get(b.key)); } catch { /* corrupt entry */ }
    const email = String((item && item.email) || "").toLowerCase();
    const ip = String((item && item.ip) || "");
    const id = String((item && item.id) || b.key);
    let match = false;
    if (keySet.size) match = keySet.has(b.key) || keySet.has(id);
    else if (p.email) match = email === p.email;
    else if (p.ip) match = ip === p.ip;
    else if (p.filter === "test") match = TEST_EMAILS.includes(email) || TEST_IPS.includes(ip) || !item;
    else if (p.filter === "all") match = true;
    if (match)
      targets.push({ key: b.key, kind: item ? item.kind : "(파싱불가)", ts: item ? item.ts : null, email: maskEmail(item && item.email), ip });
  }

  const summary = {
    total_in_store: blobs.length,
    matched: targets.length,
    remaining_after_delete: blobs.length - targets.length,
    filter: keySet.size ? `keys(${keySet.size})` : p.email ? `email=${p.email}` : p.ip ? `ip=${p.ip}` : p.filter || "(none)",
  };

  if (p.mode === "preview") {
    return json(200, { mode: "preview (아무것도 삭제되지 않았습니다)", ...summary, targets });
  }

  if (p.mode === "delete") {
    if (!p.filter && !p.email && !p.ip && !keySet.size) return json(400, { error: "filter 또는 keys/email/ip 필요" });
    const needConfirm = p.filter === "all" ? "DELETE-ALL" : "DELETE";
    if (p.confirm !== needConfirm)
      return json(400, { error: `confirm=${needConfirm} 필요. 먼저 preview로 대상을 확인하세요.`, ...summary });
    let deleted = 0, failed = 0;
    for (const t of targets) {
      try { await store.delete(t.key); deleted++; } catch { failed++; }
    }
    return json(200, { mode: "delete", deleted, failed, ...summary });
  }

  return json(400, { error: "mode는 preview 또는 delete" });
};
