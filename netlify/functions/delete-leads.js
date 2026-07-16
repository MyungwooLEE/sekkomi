/**
 * 세꼼(Sekkom) 관리자 데이터 삭제 — Netlify Blobs
 * ────────────────────────────────────────────
 * 테스트/특정 데이터를 관리자만 삭제. 토큰(ADMIN_TOKEN) 필수. 2단계 안전장치(preview → confirm).
 *
 * 사용법 (브라우저에서 GET):
 *   1) 미리보기(삭제 안 함):
 *      /api/delete-leads?token=…&mode=preview&filter=test
 *   2) 삭제 실행(확인 문자열 필수):
 *      /api/delete-leads?token=…&mode=delete&filter=test&confirm=DELETE
 *
 * filter:
 *   - test        : 알려진 테스트 식별자(아래 TEST_EMAILS / TEST_IPS)와 일치하는 항목
 *   - email=<주소> : 해당 이메일 항목만 (filter 파라미터 대신 email 파라미터)
 *   - ip=<IP>     : 해당 IP 항목만
 *   - key=<id>    : 특정 항목 1건
 *   - all         : 전체 삭제 (confirm=DELETE-ALL 필요 — 이중 확인)
 *
 * ADMIN_TOKEN 미설정 시 전면 차단. 삭제는 되돌릴 수 없으므로 반드시 preview 먼저.
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

export default async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || req.headers.get("x-admin-token") || "";
  const need = process.env.ADMIN_TOKEN || "";
  if (!need) return json(503, { error: "ADMIN_TOKEN not set" });
  if (token !== need) return json(401, { error: "unauthorized" });

  const mode = url.searchParams.get("mode") || "preview";
  const filter = url.searchParams.get("filter") || "";
  const qEmail = (url.searchParams.get("email") || "").trim().toLowerCase();
  const qIp = (url.searchParams.get("ip") || "").trim();
  const qKey = (url.searchParams.get("key") || "").trim();
  const confirm = url.searchParams.get("confirm") || "";

  const store = getStore("seggom-leads");
  const { blobs } = await store.list();

  // 대상 선별
  const targets = [];
  for (const b of blobs) {
    let item = null;
    try { item = JSON.parse(await store.get(b.key)); } catch { /* corrupt entry */ }
    const email = String((item && item.email) || "").toLowerCase();
    const ip = String((item && item.ip) || "");
    let match = false;
    if (qKey) match = b.key === qKey;
    else if (qEmail) match = email === qEmail;
    else if (qIp) match = ip === qIp;
    else if (filter === "test") match = TEST_EMAILS.includes(email) || TEST_IPS.includes(ip) || !item;
    else if (filter === "all") match = true;
    if (match)
      targets.push({
        key: b.key,
        kind: item ? item.kind : "(파싱불가)",
        ts: item ? item.ts : null,
        email: maskEmail(item && item.email),
        ip,
      });
  }

  const summary = {
    total_in_store: blobs.length,
    matched: targets.length,
    remaining_after_delete: blobs.length - targets.length,
    filter: qKey ? `key=${qKey}` : qEmail ? `email=${qEmail}` : qIp ? `ip=${qIp}` : filter || "(none)",
  };

  if (mode === "preview") {
    return json(200, { mode: "preview (아무것도 삭제되지 않았습니다)", ...summary, targets });
  }

  if (mode === "delete") {
    if (!filter && !qEmail && !qIp && !qKey) return json(400, { error: "filter 또는 email/ip/key 필요" });
    const needConfirm = filter === "all" ? "DELETE-ALL" : "DELETE";
    if (confirm !== needConfirm)
      return json(400, { error: `confirm=${needConfirm} 파라미터가 필요합니다. 먼저 mode=preview로 대상을 확인하세요.`, ...summary });
    let deleted = 0, failed = 0;
    for (const t of targets) {
      try { await store.delete(t.key); deleted++; } catch { failed++; }
    }
    return json(200, { mode: "delete", deleted, failed, ...summary });
  }

  return json(400, { error: "mode는 preview 또는 delete" });
};
