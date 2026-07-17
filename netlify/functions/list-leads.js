/**
 * 세꼼(Sekkom) 관리자 대시보드 — Netlify Blobs
 * ────────────────────────────────────────────
 * 모든 참여 데이터(익명 계산 + 이메일 리드 + 설문)를 관리자만 조회.
 * 인증: ① 세션 쿠키(어드민 OTP 로그인, /admin) ② ADMIN_TOKEN 토큰(자동화·API용) 둘 중 하나.
 *
 * 브라우저:  /admin 에서 OTP 로그인 → 이 대시보드로.
 *            (또는) /api/list-leads?token=발급토큰
 *            &kind=calc|free_email|survey  종류 필터 · &format=json|csv  내보내기
 *
 * 대시보드에서 삭제(선택/테스트/전체)와 로그아웃 지원 — delete-leads.js / admin-auth.js 연동.
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
const taxDisp = (s) => { const t = taxNum(s); if (t != null) return (t ? won(Math.round(t)) : "0") + "만원"; return s.tax ? esc(s.tax) : "-"; };
const scenNum = (s) => (s.scenarios != null ? s.scenarios : (s.context && s.context.scenarios));
const scenDisp = (s) => { const v = scenNum(s); return v != null && v !== "" ? v + "개" : "-"; };

// 어드민 세션 쿠키 검증 (admin-auth.js가 발급)
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
  const token = url.searchParams.get("token") || req.headers.get("x-admin-token") || "";
  const need = process.env.ADMIN_TOKEN || "";
  if (!need) return new Response("ADMIN_TOKEN이 설정되지 않았어요(관리자에게 문의).", { status: 503 });
  const byToken = token === need;
  const authed = byToken || (await sessionOk(req));
  if (!authed) {
    const wantsHtml = (req.headers.get("accept") || "").includes("text/html") && !url.searchParams.get("format");
    if (wantsHtml) return new Response("", { status: 302, headers: { Location: "/admin" } });
    return new Response("접근 권한이 없어요.", { status: 401 });
  }

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

  // ── 발행 수 (sitemap-blog.xml 기반) ──
  let published = null;
  try {
    const r = await fetch("https://sekkomi.com/sitemap-blog.xml");
    if (r.ok) published = ((await r.text()).match(/<loc>/g) || []).length;
  } catch {}

  // ── 7월 목표 (꼼꼼이의 성장일기 v2) ──
  const GOALS = [
    { l: "계산 완료", cur: calcN, t: 15 },
    { l: "이메일 리드", cur: emailN, t: 4 },
    { l: "설문", cur: n, t: 2 },
    { l: "블로그 발행", cur: published, t: 42 },
  ];

  const kf = url.searchParams.get("kind");
  const shown = kf ? items.filter((i) => i.kind === kf) : items;
  const T = (k) => { const ps = []; if (byToken) ps.push("token=" + esc(token)); if (k) ps.push("kind=" + k); return "?" + ps.join("&"); };

  const rowsHtml = shown.map((s) => {
    const taxc = (s.taxConnect === "paid" || s.taxConnect === "free")
      ? `<b style="color:#b45309">${esc(L_TAX[s.taxConnect])}★</b>` : esc(L_TAX[s.taxConnect] || "-");
    return `<tr>
      <td style="text-align:center"><input type="checkbox" class="selrow" value="${esc(s.id || "")}"></td>
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
.topbar{display:flex;justify-content:space-between;align-items:flex-start}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}
.c{background:#fff;border:1px solid #E5E8EB;border-radius:14px;padding:14px 18px;min-width:130px}
.c .l{font-size:12px;color:#6B7684}.c .v{font-size:24px;font-weight:800;color:#163300;margin-top:4px}
.c .s{font-size:12px;color:#1DA45A;margin-top:2px;font-weight:600}
.rowlabel{font-size:12px;color:#8B95A1;margin:14px 0 2px;font-weight:700}
.tools{margin:10px 0}.tools a{display:inline-block;margin-right:8px;font-size:13px;color:#3182F6;text-decoration:none}
.filters{margin:12px 0 6px}.fl{display:inline-block;margin-right:6px;padding:5px 12px;border-radius:999px;font-size:13px;text-decoration:none;color:#4E5968;background:#EEF1F4}
.fl.on{background:#163300;color:#fff;font-weight:700}
.dbtn{border:1px solid #E5E8EB;background:#fff;color:#D22030;font-size:13px;font-weight:700;padding:7px 14px;border-radius:10px;cursor:pointer;margin-right:6px}
.dbtn.warn{background:#D22030;color:#fff;border-color:#D22030}
.dbtn.ghost{color:#4E5968;font-weight:600}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;font-size:13px}
th,td{padding:9px 10px;border-bottom:1px solid #E5E8EB;text-align:left;vertical-align:top}
th{background:#F2F4F6;color:#4E5968;font-weight:700;white-space:nowrap}</style></head><body>
<div class="topbar">
  <div><h1>세꼼 어드민 대시보드</h1>
  <div class="sub">모든 참여 데이터 · 총 ${items.length}건 (계산 ${calcN} · 이메일 ${emailN} · 설문 ${n})</div></div>
  <button class="dbtn ghost" onclick="logout()">로그아웃</button>
</div>

<div class="rowlabel">7월 목표 스코어카드 (꼼꼼이의 성장일기 · ~7/31)</div>
<div class="cards">
${GOALS.map((g) => {
  const cur = g.cur == null ? "?" : g.cur;
  const p = g.cur == null ? 0 : Math.min(100, Math.round((g.cur / g.t) * 100));
  return `<div class="c" style="min-width:150px"><div class="l">${g.l}</div><div class="v">${cur}<span style="font-size:13px;color:#8B95A1;font-weight:600"> / ${g.t}</span></div>
  <div style="background:#EEF1F4;border-radius:99px;height:6px;margin-top:8px"><div style="background:${p >= 100 ? "#2FA968" : "#163300"};width:${p}%;height:6px;border-radius:99px"></div></div>
  <div class="s">${p}%</div></div>`;
}).join("")}
  <div class="c" style="min-width:150px"><div class="l">방문·노출·클릭</div><div class="v" style="font-size:14px;line-height:1.5;font-weight:600">GA4·GSC에서 확인<br><span style="font-size:11px;color:#8B95A1">목표: 방문 250 · 노출 1,000 · 클릭 8</span></div></div>
</div>

<div class="rowlabel">운영 퀵링크</div>
<div class="tools" style="margin-top:6px">
  <a href="https://search.google.com/search-console" target="_blank">Search Console</a>
  <a href="https://analytics.google.com" target="_blank">GA4</a>
  <a href="https://searchadvisor.naver.com" target="_blank">네이버 서치어드바이저</a>
  <a href="https://app.netlify.com/projects/sekkomi" target="_blank">Netlify</a>
  <a href="https://github.com/MyungwooLEE/sekkomi" target="_blank">GitHub</a>
  <a href="https://business.facebook.com" target="_blank">메타 비즈니스</a>
  <a href="https://studio.youtube.com" target="_blank">유튜브 스튜디오</a>
  <a href="https://sekkomi.com/blog/" target="_blank">블로그</a>
</div>

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
<div class="tools">
  <label style="font-size:13px;margin-right:10px"><input type="checkbox" onclick="document.querySelectorAll('.selrow').forEach(c=>c.checked=this.checked)"> 전체 선택</label>
  <button class="dbtn" onclick="delSel()">선택 삭제</button>
  <button class="dbtn" onclick="delFilter('test','DELETE','테스트 데이터(알려진 테스트 이메일·IP)를')">테스트 데이터 삭제</button>
  <button class="dbtn warn" onclick="delFilter('all','DELETE-ALL','전체 데이터를')">전체 삭제</button>
</div>
<table><thead><tr>
<th></th><th>일시</th><th>종류</th><th>지역</th><th>세액</th><th>시나리오</th><th>케이스</th><th>만족</th><th>구매의향</th><th>적정가</th><th>세무사</th><th>연령</th><th>이메일</th><th>의견</th>
</tr></thead><tbody>${rowsHtml || '<tr><td colspan="14" style="text-align:center;color:#8B95A1;padding:24px">아직 데이터가 없어요.</td></tr>'}</tbody></table>
<div class="rowlabel" style="margin-top:20px">로그인 세션 관리</div>
<div id="sessBox" style="background:#fff;border:1px solid #E5E8EB;border-radius:12px;padding:14px 16px;font-size:13px;color:#6B7684">세션 정보 로딩 중... (토큰 접속 시에는 표시되지 않아요)</div>
<p style="font-size:11px;color:#8B95A1;margin-top:16px">삭제는 되돌릴 수 없어요 · 세션은 7일 뒤 만료됩니다 · 이 링크를 공유하지 마세요.</p>
<script>
async function post(u, body){
  const r = await fetch(u, {method:"POST", credentials:"same-origin", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body)});
  return r.json();
}
async function delSel(){
  const keys = Array.from(document.querySelectorAll(".selrow:checked")).map(c=>c.value).filter(Boolean);
  if(!keys.length) return alert("삭제할 항목을 체크하세요");
  if(!confirm(keys.length + "건을 삭제할까요? 되돌릴 수 없어요.")) return;
  const r = await post("/api/delete-leads", {mode:"delete", keys:keys, confirm:"DELETE"});
  alert("삭제 " + (r.deleted!=null?r.deleted:0) + "건" + (r.error?(" / 오류: "+r.error):""));
  location.reload();
}
async function delFilter(f, c, label){
  if(!confirm(label + " 삭제할까요? 되돌릴 수 없어요.")) return;
  if(f === "all" && !confirm("정말 전체 삭제합니까? 실사용 데이터도 모두 지워집니다.")) return;
  const r = await post("/api/delete-leads", {mode:"delete", filter:f, confirm:c});
  alert("삭제 " + (r.deleted!=null?r.deleted:0) + "건 (대상 " + (r.matched!=null?r.matched:"?") + ")" + (r.error?(" / 오류: "+r.error):""));
  location.reload();
}
async function logout(){
  await post("/api/admin-auth", {action:"logout"});
  location.href = "/admin";
}
async function loadSessions(){
  const box = document.getElementById("sessBox");
  try{
    const r = await post("/api/admin-auth", {action:"sessions"});
    if(!r.ok){ box.textContent = "세션 목록은 OTP 로그인 상태에서만 볼 수 있어요 (현재 토큰 접속)"; return; }
    const dt = (ts) => ts ? new Date(ts).toLocaleString("ko-KR") : "-";
    box.innerHTML = r.sessions.map(s =>
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #F2F4F6">' +
      '<span>' + (s.current ? "🟢 <b>현재 세션</b>" : "세션 " + s.id) + ' · 로그인 ' + dt(s.at) + ' · 만료 ' + dt(s.exp) + '</span>' +
      (s.current ? '<span style="color:#8B95A1;font-size:12px">로그아웃 버튼 사용</span>'
        : '<button class="dbtn" style="padding:4px 10px" onclick="revoke(\\'' + s.id + '\\')">해지</button>') +
      '</div>').join("") +
      (r.sessions.length > 1 ? '<div style="margin-top:10px"><button class="dbtn" onclick="revoke(\\'others\\')">다른 세션 모두 로그아웃</button></div>' : "");
  }catch(e){ box.textContent = "세션 정보를 불러오지 못했어요"; }
}
async function revoke(target){
  const r = await post("/api/admin-auth", {action:"revoke", target:target});
  alert(r.ok ? "해지 " + r.revoked + "건" : (r.error || "실패"));
  loadSessions();
}
loadSessions();
</script>
</body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
};
