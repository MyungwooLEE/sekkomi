/**
 * 세꼼(Sekkom) 관리자 대시보드 — Netlify Blobs
 * ────────────────────────────────────────────
 * 모든 참여 데이터(익명 계산 + 이메일 리드 + 설문)를 관리자만 조회. 토큰(ADMIN_TOKEN) 필수.
 *
 * 브라우저:  /api/list-leads?token=발급토큰                → HTML 대시보드
 *            /api/list-leads?token=…&kind=calc|free_email|survey  → 종류 필터
 *            /api/list-leads?token=…&format=json           → 원본 JSON
 *            /api/list-leads?token=…&format=csv            → 엑셀용 CSV
 *
 * ADMIN_TOKEN 환경변수 미설정 시 전면 차단(안전 기본값).
 */
import { getStore } from "@netlify/blobs";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const L_VS = { better: "훨씬 낫다", similar: "비슷하다", worse: "별로다", na: "모름" };
const L_BUY = { yes: "결제의향", maybe: "고민", no: "아니오" };
const L_TAX = { paid: "유료OK", free: "무료면", later: "나중에", no: "불필요" };
const L_CASE = { general: "일반과세", exempt_under: "비과세(12억↓)", exempt_over: "비과세 초과분", exempt_under_mixed: "비과세(상가주택)", loss: "손실", non_resident: "비거주자" };
const KIND = { survey: "설문", free_email: "이메일", calc: "계산" };
const KIND_COLOR = { survey: "#1D9BF0", free_email: "#7C3AED", calc: "#64748B" };
const won = (n) => { const v = Number(n); return isFinite(v) && n ? v.toLocaleString("ko-KR") : "-"; };
const dt = (ts) => { const d = new Date(Number(ts) || 0); const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

const regionOf = (s) => s.region || (s.context && s.context.addr) || s.address || "";
const taxNum = (s) => { const t = s.context && s.context.tax; if (isFinite(t)) return Number(t); if (typeof s.tax === "number") return s.tax; return null; };
const taxDisp = (s) => { const t = taxNum(s); if (t != null) return (t ? won(t) : "0") + "만원"; return s.tax ? esc(s.tax) : "-"; };
const scenNum = (s) => (s.scenarios != null ? s.scenarios : (s.context && s.context.scenarios));
const scenDisp = (s) => { const v = scenNum(s); return v != null && v !== "" ? v + "개" : "-"; };

export default async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || req.headers.get("x-admin-token") || "";
  const need = process.env.ADMIN_TOKEN || "";
  if (!need) return new Response("ADMIN_TOKEN이 설정되지 않았어요(관리자에게 문의).", { status: 503 });
  if (token !== need) return new Response("접근 권한이 없어요.", { status: 401 });

  const store = getStore("seggom-leads");
  const { blobs } = await store.list();
  const items = [];
  for (const b of blobs) { try { items.push(JSON.parse(await store.get(b.key))); } catch {} }
  items.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const format = url.searchParams.get("format");
  if (format === "json")
    return new Response(JSON.stringify(items, null, 2), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });

  if (format === "csv") {
    const head = ["일시", "종류", "지역", "세액(만원)", "시나리오", "케이스", "만족", "비교", "구매의향", "적정가(원)", "세무사", "연령", "이메일", "의견"].join(",");
    const rows = items.map((s) => [
      dt(s.ts), KIND[s.kind] || s.kind, regionOf(s), taxNum(s) != null ? taxNum(s) : "", scenNum(s) != null ? scenNum(s) : "",
      L_CASE[s.caseId] || s.caseId || "", s.satisfaction || "", L_VS[s.vsOthers] || "", L_BUY[s.buyIntent] || "",
      s.fairPrice || "", L_TAX[s.taxConnect] || "", s.ageBand || "", s.email || "", String(s.freeText || "").replace(/[\r\n,]/g, " "),
    ].map((v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`).join(","));
    return new Response("﻿" + head + "\n" + rows.join("\n"),
      { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=seggom-leads.csv" } });
  }

  // ── 퍼널 카운트 ──
  const calcN = items.filter((i) => i.kind === "calc").length;
  const emailN = items.filter((i) => i.kind === "free_email").length;
  const surveys = items.filter((i) => i.kind === "survey");
  const n = surveys.length;
  const avgSat = n ? (surveys.reduce((a, s) => a + (Number(s.satisfaction) || 0), 0) / n).toFixed(2) : "-";
  const wantTax = surveys.filter((s) => s.taxConnect === "paid" || s.taxConnect === "free").length;
  const buyYes = surveys.filter((s) => s.buyIntent === "yes").length;
  const prices = surveys.map((s) => Number(s.fairPrice)).filter((v) => isFinite(v) && v > 0).sort((a, b) => a - b);
  const medPrice = prices.length ? prices[Math.floor(prices.length / 2)] : 0;
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) + "%" : "-");

  const kf = url.searchParams.get("kind");
  const shown = kf ? items.filter((i) => i.kind === kf) : items;
  const T = (k) => `?token=${esc(token)}` + (k ? `&kind=${k}` : "");

  const rowsHtml = shown.map((s) => {
    const taxc = (s.taxConnect === "paid" || s.taxConnect === "free")
      ? `<b style="color:#b45309">${esc(L_TAX[s.taxConnect])}★</b>` : esc(L_TAX[s.taxConnect] || "-");
    return `<tr>
      <td>${esc(dt(s.ts))}</td>
      <td><span style="background:${KIND_COLOR[s.kind] || "#64748B"};color:#fff;padding:2px 7px;border-radius:999px;font-size:11px">${esc(KIND[s.kind] || s.kind)}</span></td>
      <td>${esc(regionOf(s) || "-")}</td>
      <td style="text-align:right;white-space:nowrap">${taxDisp(s)}</td>
      <td style="text-align:center">${esc(scenDisp(s))}</td>
      <td>${esc(L_CASE[s.caseId] || s.caseId || "-")}</td>
      <td style="text-align:center">${s.satisfaction ? "★" + esc(s.satisfaction) : "-"}</td>
      <td>${esc(L_BUY[s.buyIntent] || "-")}</td>
      <td style="text-align:right">${won(s.fairPrice)}</td>
      <td>${taxc}</td>
      <td>${esc(s.ageBand ? s.ageBand + "대" : "-")}</td>
      <td>${esc(s.email || "-")}</td>
      <td style="max-width:200px">${esc(s.freeText || "")}</td>
    </tr>`;
  }).join("");

  const card = (l, v, sub) => `<div class="c"><div class="l">${l}</div><div class="v">${v}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`;
  const chip = (k, label) => `<a class="fl${kf === k || (!kf && !k) ? " on" : ""}" href="${T(k)}">${label}</a>`;

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>세꼼 어드민</title>
<style>body{font-family:'Pretendard','Apple SD Gothic Neo',sans-serif;background:#F9FAFB;margin:0;padding:24px;color:#191F28}
h1{font-size:20px;margin:0 0 4px}.sub{font-size:13px;color:#6B7684;margin-bottom:16px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}
.c{background:#fff;border:1px solid #E5E8EB;border-radius:14px;padding:14px 18px;min-width:130px}
.c .l{font-size:12px;color:#6B7684}.c .v{font-size:24px;font-weight:800;color:#163300;margin-top:4px}
.c .s{font-size:12px;color:#1DA45A;margin-top:2px;font-weight:600}
.rowlabel{font-size:12px;color:#8B95A1;margin:14px 0 2px;font-weight:700}
.tools{margin:10px 0}.tools a{display:inline-block;margin-right:8px;font-size:13px;color:#3182F6;text-decoration:none}
.filters{margin:12px 0 6px}.fl{display:inline-block;margin-right:6px;padding:5px 12px;border-radius:999px;font-size:13px;text-decoration:none;color:#4E5968;background:#EEF1F4}
.fl.on{background:#163300;color:#fff;font-weight:700}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;font-size:13px}
th,td{padding:9px 10px;border-bottom:1px solid #E5E8EB;text-align:left;vertical-align:top}
th{background:#F2F4F6;color:#4E5968;font-weight:700;white-space:nowrap}</style></head><body>
<h1>세꼼 어드민 대시보드</h1>
<div class="sub">모든 참여 데이터 · 총 ${items.length}건 (계산 ${calcN} · 이메일 ${emailN} · 설문 ${n})</div>

<div class="rowlabel">참여 퍼널</div>
<div class="cards">
  ${card("계산 완료", calcN, "익명 포함")}
  ${card("이메일 남김", emailN, "전환 " + pct(emailN, calcN))}
  ${card("설문 완료", n, "전환 " + pct(n, calcN))}
  ${card("세무사 연결 희망", wantTax)}
</div>

<div class="rowlabel">설문 인사이트</div>
<div class="cards">
  ${card("평균 만족도", avgSat)}
  ${card("결제 의향 '예'", buyYes)}
  ${card("적정가 중앙값", medPrice ? won(medPrice) + "원" : "-")}
</div>

<div class="filters">${chip("", "전체")}${chip("calc", "계산")}${chip("free_email", "이메일")}${chip("survey", "설문")}</div>
<div class="tools">
  <a href="${T(kf)}&format=csv">⬇ CSV 내보내기</a>
  <a href="${T(kf)}&format=json">원본 JSON</a>
</div>
<table><thead><tr>
<th>일시</th><th>종류</th><th>지역</th><th>세액</th><th>시나리오</th><th>케이스</th><th>만족</th><th>구매의향</th><th>적정가</th><th>세무사</th><th>연령</th><th>이메일</th><th>의견</th>
</tr></thead><tbody>${rowsHtml || '<tr><td colspan="13" style="text-align:center;color:#8B95A1;padding:24px">아직 데이터가 없어요.</td></tr>'}</tbody></table>
<p style="font-size:11px;color:#8B95A1;margin-top:16px">이 페이지는 토큰으로 보호돼요. 링크를 공유하지 마세요.</p>
</body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
};
