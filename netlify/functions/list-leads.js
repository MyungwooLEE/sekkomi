/**
 * 세꼼(Sekkom) 관리자 리드 조회 — Netlify Blobs
 * ────────────────────────────────────────────
 * 저장된 설문/리드를 관리자만 볼 수 있게 조회. 토큰(ADMIN_TOKEN) 필수.
 *
 * 브라우저:  https://<사이트>/api/list-leads?token=발급토큰            → HTML 표
 * JSON:      https://<사이트>/api/list-leads?token=발급토큰&format=json → 원본 JSON
 * CSV:       https://<사이트>/api/list-leads?token=발급토큰&format=csv  → 엑셀용 CSV
 *
 * ADMIN_TOKEN 환경변수 미설정 시 전면 차단(안전 기본값).
 */
import { getStore } from "@netlify/blobs";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const L_VS = { better: "훨씬 낫다", similar: "비슷하다", worse: "별로다", na: "모름" };
const L_BUY = { yes: "결제의향", maybe: "고민", no: "아니오" };
const L_TAX = { paid: "유료OK", free: "무료면", later: "나중에", no: "불필요" };
const won = (n) => { const v = Number(n); return isFinite(v) && n ? v.toLocaleString("ko-KR") : "-"; };
const dt = (ts) => { const d = new Date(Number(ts) || 0); const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

export default async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || req.headers.get("x-admin-token") || "";
  const need = process.env.ADMIN_TOKEN || "";
  if (!need) return new Response("ADMIN_TOKEN이 설정되지 않았어요(관리자에게 문의).", { status: 503 });
  if (token !== need) return new Response("접근 권한이 없어요.", { status: 401 });

  const store = getStore("seggom-leads");
  const { blobs } = await store.list();
  const items = [];
  for (const b of blobs) {
    try { items.push(JSON.parse(await store.get(b.key))); } catch {}
  }
  items.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const format = url.searchParams.get("format");
  if (format === "json")
    return new Response(JSON.stringify(items, null, 2), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });

  if (format === "csv") {
    const cols = ["ts", "kind", "satisfaction", "vsOthers", "buyIntent", "fairPrice", "taxConnect", "ageBand", "email", "freeText"];
    const head = ["일시", ...cols.slice(1)].join(",");
    const rows = items.map((s) => [dt(s.ts), s.kind, s.satisfaction, s.vsOthers, s.buyIntent, s.fairPrice, s.taxConnect, s.ageBand, s.email,
      String(s.freeText || "").replace(/[\r\n,]/g, " ")].map((v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`).join(","));
    return new Response("﻿" + head + "\n" + rows.join("\n"),
      { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=seggom-leads.csv" } });
  }

  // ── 요약 통계 ──
  const surveys = items.filter((i) => i.kind === "survey");
  const n = surveys.length;
  const avgSat = n ? (surveys.reduce((a, s) => a + (Number(s.satisfaction) || 0), 0) / n).toFixed(2) : "-";
  const wantTax = surveys.filter((s) => s.taxConnect === "paid" || s.taxConnect === "free").length;
  const buyYes = surveys.filter((s) => s.buyIntent === "yes").length;
  const prices = surveys.map((s) => Number(s.fairPrice)).filter((v) => isFinite(v) && v > 0).sort((a, b) => a - b);
  const medPrice = prices.length ? prices[Math.floor(prices.length / 2)] : 0;

  const rowsHtml = items.map((s) => {
    const tax = (s.taxConnect === "paid" || s.taxConnect === "free")
      ? `<b style="color:#b45309">${esc(L_TAX[s.taxConnect])}★</b>` : esc(L_TAX[s.taxConnect] || "-");
    return `<tr>
      <td>${esc(dt(s.ts))}</td>
      <td>${s.kind === "survey" ? "설문" : "이메일"}</td>
      <td>${s.satisfaction ? "★" + esc(s.satisfaction) : "-"}</td>
      <td>${esc(L_BUY[s.buyIntent] || "-")}</td>
      <td style="text-align:right">${won(s.fairPrice)}</td>
      <td>${tax}</td>
      <td>${esc(s.ageBand ? s.ageBand + "대" : "-")}</td>
      <td>${esc(s.email || "-")}</td>
      <td>${esc((s.context && s.context.addr) || s.address || "-")}</td>
      <td style="max-width:220px">${esc(s.freeText || "")}</td>
    </tr>`;
  }).join("");

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>세꼼 리드 대시보드</title>
<style>body{font-family:'Apple SD Gothic Neo',sans-serif;background:#F9FAFB;margin:0;padding:24px;color:#191F28}
h1{font-size:20px}.cards{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}
.c{background:#fff;border:1px solid #E5E8EB;border-radius:14px;padding:14px 18px;min-width:120px}
.c .l{font-size:12px;color:#6B7684}.c .v{font-size:22px;font-weight:800;color:#3182F6;margin-top:4px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;font-size:13px}
th,td{padding:9px 10px;border-bottom:1px solid #E5E8EB;text-align:left;vertical-align:top}
th{background:#F2F4F6;color:#4E5968;font-weight:700;white-space:nowrap}
.tools{margin:8px 0}.tools a{display:inline-block;margin-right:8px;font-size:13px;color:#3182F6;text-decoration:none}</style></head><body>
<h1>세꼼 리드 대시보드 <span style="font-size:13px;color:#6B7684">· 총 ${items.length}건 (설문 ${n})</span></h1>
<div class="cards">
  <div class="c"><div class="l">설문 응답</div><div class="v">${n}</div></div>
  <div class="c"><div class="l">평균 만족도</div><div class="v">${avgSat}</div></div>
  <div class="c"><div class="l">결제 의향 '예'</div><div class="v">${buyYes}</div></div>
  <div class="c"><div class="l">세무사 연결 희망</div><div class="v">${wantTax}</div></div>
  <div class="c"><div class="l">적정가 중앙값</div><div class="v">${medPrice ? won(medPrice) : "-"}</div></div>
</div>
<div class="tools">
  <a href="?token=${esc(token)}&format=csv">⬇ CSV 내보내기</a>
  <a href="?token=${esc(token)}&format=json">원본 JSON</a>
</div>
<table><thead><tr>
<th>일시</th><th>종류</th><th>만족</th><th>구매의향</th><th>적정가</th><th>세무사</th><th>연령</th><th>이메일</th><th>주소</th><th>의견</th>
</tr></thead><tbody>${rowsHtml || '<tr><td colspan="10" style="text-align:center;color:#8B95A1;padding:24px">아직 데이터가 없어요.</td></tr>'}</tbody></table>
<p style="font-size:11px;color:#8B95A1;margin-top:16px">이 페이지는 토큰으로 보호돼요. 링크를 공유하지 마세요.</p>
</body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
};
