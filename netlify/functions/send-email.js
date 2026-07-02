/**
 * 세꼼(Sekkom) 이메일 발송 함수 — Resend
 * ────────────────────────────────────────────
 * 프론트(브라우저)는 이 함수만 호출하고, Resend API 키는 절대 노출되지 않음.
 * 키는 Netlify 환경변수 RESEND_API_KEY 에만 저장.
 *
 * 호출: POST /.netlify/functions/send-email
 * body: { type, to, data }
 *
 * - type=otp           → 6자리 인증코드 생성 → Blobs에 5분 저장 → 메일 발송
 * - type=result        → 무료 양도세 결과 요약 메일 (data: {address, tax, scenarios})
 * - type=survey_thanks → 베타 설문 완료 감사 메일 (data: {taxConnect})
 * - type=admin_lead    → 관리자 알림 메일 (수신처는 ADMIN_EMAIL로 강제, 클라 to 무시)
 *
 * 발신/수신 정리:
 * - From       : MAIL_FROM (기본 테스트용 onboarding@resend.dev). gmail 주소는 From 불가.
 * - reply_to   : REPLY_TO (고객이 답장하면 이 지메일로 옴)
 * - 관리자수신 : ADMIN_EMAIL
 *
 * 보안: 정해진 템플릿만 발송(임의 본문 발송 불가) → 스팸 악용 차단.
 */

import { getStore } from "@netlify/blobs";

// Resend는 우리가 소유·인증한 도메인에서만 발신 가능(gmail.com From 불가).
// 도메인 인증 전엔 테스트용 onboarding@resend.dev, 인증 후 noreply@sekkomi.com 으로 교체.
const FROM = process.env.MAIL_FROM || "세꼼 <onboarding@resend.dev>";
// 고객 메일 회신처(답장은 이 지메일로 도착)
const REPLY_TO = process.env.REPLY_TO || "sekkomi.com@gmail.com";
// 관리자 알림 수신처
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "sekkomi.com@gmail.com";
const API = "https://api.resend.com/emails";

// 간단 레이트리밋(동일 이메일 1분 1회) — Blobs 사용
async function tooFrequent(store, to) {
  const key = "rl:" + to;
  const last = await store.get(key);
  if (last && Date.now() - Number(last) < 60_000) return true;
  await store.set(key, String(Date.now()));
  return false;
}

function cors() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": process.env.ALLOW_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function sendViaResend(to, subject, html) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject, html }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error("Resend " + res.status + ": " + t);
  }
  return res.json();
}

// ───── 공통 유틸 ─────
const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const won = (n) => {
  const v = Number(n);
  if (!isFinite(v) || !n) return "-";
  return v.toLocaleString("ko-KR") + "원";
};

const stars = (n) => {
  const v = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  return "★".repeat(v) + "☆".repeat(5 - v);
};

// ───── 고객 메일 공통 레이아웃 ─────
const wrap = (inner) => `<!doctype html><html><body style="margin:0;background:#f4f6f9;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center" style="padding:28px 16px">
<table width="100%" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="background:#163300;color:#ffffff;padding:20px 24px;font-size:19px;font-weight:800;letter-spacing:-0.3px">세꼼<span style="font-size:12px;font-weight:600;opacity:.85;margin-left:8px">부동산 양도세</span></td></tr>
<tr><td style="padding:26px 24px;color:#1e293b;font-size:15px;line-height:1.75">${inner}</td></tr>
<tr><td style="padding:18px 24px;background:#f8fafc;color:#94a3b8;font-size:11px;line-height:1.7;border-top:1px solid #eef2f7">
세꼼(Sekkom) · 부동산 양도세 계산 서비스<br>
본 메일은 발신 전용입니다. 답장하시면 담당자 메일로 전달돼요.<br>
궁금한 점은 회신으로 편하게 남겨주세요.</td></tr>
</table></td></tr></table></body></html>`;

const tplOtp = (code) => wrap(
  `<b style="font-size:17px;color:#0f172a">인증번호를 입력해주세요</b>
   <p style="margin:10px 0 0">아래 6자리 번호를 화면에 입력해주세요.</p>
   <div style="margin:18px 0;padding:18px;background:#EFF3E9;border:1px solid #D8E7C4;border-radius:12px;text-align:center;
     font-size:32px;font-weight:800;letter-spacing:10px;color:#163300">${esc(code)}</div>
   <p style="color:#64748b;font-size:13px;margin:0">이 번호는 <b>5분간</b> 유효해요.<br>요청하지 않으셨다면 무시하셔도 됩니다.</p>`
);

const tplResult = (d) => wrap(
  `<b style="font-size:17px;color:#0f172a">요청하신 양도세 결과예요</b>
   <p style="margin:10px 0 0">${esc(d.address) || "입력하신 주택"} 기준</p>
   <p style="margin:2px 0 0">예상 양도소득세를 정리했어요.</p>
   <div style="margin:16px 0;padding:18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px">
     <div style="font-size:13px;color:#64748b">예상 양도소득세</div>
     <div style="font-size:27px;font-weight:800;color:#163300;margin-top:4px">${esc(d.tax) || "-"}</div>
   </div>
   <p style="margin:0">줄일 수 있는 절세 시나리오 <b>${Number(d.scenarios) || 0}개</b>를 준비했어요.</p>
   <p style="margin:8px 0 0;padding:12px 14px;background:#E9F7EE;border-radius:10px;color:#0F7A3D;font-size:14px">
     베타 기간이라 <b>지금은 전부 무료</b>로 열려 있어요.</p>
   <p style="font-size:12px;color:#94a3b8;margin:14px 0 0">※ 입력값 기반 예상치예요.<br>실제 신고 전 세무사 확인을 권해드려요.</p>`
);

const tplSurveyThanks = (d) => {
  const wantsTax = d && (d.taxConnect === "paid" || d.taxConnect === "free" || d.taxConnect === "later");
  return wrap(
    `<b style="font-size:17px;color:#0f172a">설문 응답 고맙습니다</b>
     <p style="margin:10px 0 0">소중한 의견 잘 받았어요.</p>
     <p style="margin:8px 0 0;padding:12px 14px;background:#E9F7EE;border-radius:10px;color:#0F7A3D;font-size:14px">
       베타 기간 절세 시나리오를 <b>모두 무료</b>로 열어드렸어요.</p>
     <p style="margin:14px 0 0">남겨주신 의견은 세꼼이를 더 똑똑하게 만드는 데 쓰여요.</p>
     ${wantsTax
       ? `<p style="margin:10px 0 0">세무사 상담 연결을 원하셨죠?<br>준비되는 대로 회신으로 안내드릴게요.</p>`
       : ``}
     <p style="margin:14px 0 0;color:#475569">오늘도 편안한 하루 보내세요.</p>`
  );
};

// ───── 관리자 알림 메일(admin_lead) ─────
const L_VS = { better: "훨씬 낫다", similar: "비슷하다", worse: "별로다", na: "비교 불가/모름" };
const L_BUY = { yes: "네, 결제 의향", maybe: "고민 중", no: "아니오" };
const L_TAX = { paid: "유료여도 좋다", free: "무료면 좋다", later: "나중에 생각", no: "원치 않음" };

const adminRow = (label, value) =>
  `<tr>
     <td style="padding:9px 12px;background:#f8fafc;border:1px solid #e2e8f0;font-size:13px;color:#64748b;width:140px;vertical-align:top">${esc(label)}</td>
     <td style="padding:9px 12px;border:1px solid #e2e8f0;font-size:14px;color:#0f172a;vertical-align:top">${value}</td>
   </tr>`;

const tplAdminLead = (s) => {
  s = s || {};
  const ctx = s.context || {};
  const liked = Array.isArray(s.liked) ? s.liked.filter(Boolean) : [];
  const wantsTax = s.taxConnect === "paid" || s.taxConnect === "free";

  const taxConnectCell = wantsTax
    ? `<span style="display:inline-block;padding:4px 10px;background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;color:#b45309;font-weight:800">★ ${esc(L_TAX[s.taxConnect])} — 세무사 연결 희망</span>`
    : esc(L_TAX[s.taxConnect] || s.taxConnect || "-");

  const highlight = wantsTax
    ? `<div style="margin:0 0 16px;padding:14px 16px;background:#fffbeb;border:2px solid #f59e0b;border-radius:12px;color:#92400e;font-size:15px;font-weight:800">
         🔥 세무사 연결 희망 리드입니다 — 우선 응대 대상</div>`
    : ``;

  const rows = [
    adminRow("만족도", `${stars(s.satisfaction)} <span style="color:#64748b;font-size:12px">(${esc(s.satisfaction || "-")}/5)</span>`),
    adminRow("타 서비스 대비", esc(L_VS[s.vsOthers] || s.vsOthers || "-")),
    adminRow("결제 의향", esc(L_BUY[s.buyIntent] || s.buyIntent || "-")),
    adminRow("적정가(생각)", won(s.fairPrice)),
    adminRow("세무사 연결", taxConnectCell),
    adminRow("좋았던 점", liked.length ? esc(liked.join(", ")) : "-"),
    adminRow("연령대", s.ageBand ? esc(s.ageBand) + "대" : "-"),
    adminRow("응답자 이메일", s.email ? `<a href="mailto:${esc(s.email)}" style="color:#163300">${esc(s.email)}</a>` : "-"),
    adminRow("자유 의견", s.freeText ? esc(s.freeText) : "-"),
  ].join("");

  const ctxRows = [
    adminRow("입력 주소", esc(ctx.addr || "-")),
    adminRow("계산 양도세", esc(ctx.tax || "-")),
    adminRow("시나리오 수", ctx.scenarios != null ? esc(ctx.scenarios) + "개" : "-"),
  ].join("");

  return `<!doctype html><html><body style="margin:0;background:#f4f6f9;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center" style="padding:24px 16px">
<table width="100%" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="background:#0f172a;color:#ffffff;padding:18px 22px;font-size:17px;font-weight:800">세꼼 관리자 · 새 베타 설문 응답</td></tr>
<tr><td style="padding:22px">
${highlight}
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>
<div style="margin:18px 0 8px;font-size:13px;font-weight:700;color:#475569">응답 당시 계산 컨텍스트</div>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${ctxRows}</table>
</td></tr>
<tr><td style="padding:14px 22px;background:#f8fafc;color:#94a3b8;font-size:11px;border-top:1px solid #eef2f7">세꼼 내부 알림 · 자동 발송</td></tr>
</table></td></tr></table></body></html>`;
};

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors() });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: cors() });

  let payload;
  try { payload = await req.json(); } catch { return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers: cors() }); }
  const { type, to, data } = payload || {};

  if (!process.env.RESEND_API_KEY)
    return new Response(JSON.stringify({ error: "RESEND_API_KEY not set" }), { status: 500, headers: cors() });

  // ── 관리자 알림: 수신처는 ADMIN_EMAIL로 강제(클라가 보낸 to 무시) ──
  if (type === "admin_lead") {
    const survey = (data && data.survey) || {};
    const sat = survey.satisfaction ? `★${survey.satisfaction}` : "★-";
    const tax = L_TAX[survey.taxConnect] || "미응답";
    try {
      await sendViaResend(ADMIN_EMAIL, `[세꼼 관리자] 새 베타 설문 응답 (만족도 ${sat} · 세무사연결: ${tax})`, tplAdminLead(survey));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors() });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: cors() });
    }
  }

  // ── 고객 메일(otp/result/survey_thanks): to 유효성 + 레이트리밋 ──
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to))
    return new Response(JSON.stringify({ error: "invalid email" }), { status: 400, headers: cors() });

  const store = getStore("seggom-mail");
  if (await tooFrequent(store, to))
    return new Response(JSON.stringify({ error: "잠시 후 다시 시도해주세요(1분 제한)" }), { status: 429, headers: cors() });

  try {
    if (type === "otp") {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await getStore("seggom-otp").set("otp:" + to, JSON.stringify({ code, exp: Date.now() + 5 * 60_000 }));
      await sendViaResend(to, "[세꼼] 인증번호 " + code, tplOtp(code));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors() }); // 코드는 응답에 절대 포함 안 함
    }
    if (type === "result") {
      await sendViaResend(to, "[세꼼] 양도세 결과를 보내드려요", tplResult(data || {}));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors() });
    }
    if (type === "survey_thanks") {
      await sendViaResend(to, "[세꼼] 설문 응답 감사합니다", tplSurveyThanks(data || {}));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors() });
    }
    return new Response(JSON.stringify({ error: "unknown type" }), { status: 400, headers: cors() });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: cors() });
  }
};
