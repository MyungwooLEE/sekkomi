/* ─────────────────────────────────────────────────────────
   세꼼 프론트 → 이메일 함수 호출 스니펫
   프로토타입 HTML <script> 안에 붙여넣고, 아래 3곳에서 호출하세요.
   (Netlify에 함수와 함께 배포돼 있어야 실제 발송됩니다.
    로컬에서 파일로 열면 발송은 안 되고 콘솔 로그만 남아요 — 안전하게 무시됨)
   ───────────────────────────────────────────────────────── */

const SEGGOM_API = "/api"; // netlify.toml redirect 기준. 함수 직접 경로면 "/.netlify/functions"

async function seggomMail(type, to, data) {
  try {
    const r = await fetch(SEGGOM_API + "/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, to, data }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    return { ok: true };
  } catch (e) {
    console.warn("[세꼼] 메일 발송 생략/실패:", e.message); // 로컬·오프라인에서는 조용히 패스
    return { ok: false, error: e.message };
  }
}
async function seggomVerifyOtp(to, code) {
  const r = await fetch(SEGGOM_API + "/verify-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, code }),
  });
  return r.json(); // { ok:true } 또는 { ok:false, error }
}

/* ── 연결 위치 1: 무료 이메일 수집(S04-A) 후 결과 메일 ──
   emailCard()에서 A.email 확정 직후:
   if (A.email) seggomMail("result", A.email, {
     address: A.address && A.address.road,
     tax: fmtMan(A.R ? A.R.total : 0),
     scenarios: (A.S || []).length
   });
*/

/* ── 연결 위치 2: 베타 설문 제출(submitSurvey) 성공 후 감사 메일 ──
   submitSurvey() 안, openS11 직전:
   seggomMail("survey_thanks", email);
*/

/* ── 연결 위치 3: 결제/OTP 흐름(정식 출시 시) ──
   OTP 발송:   await seggomMail("otp", email);   // 화면엔 "인증번호를 보냈어요"
   OTP 검증:   const res = await seggomVerifyOtp(email, inputCode);
               if (res.ok) { 인증성공 } else { alert(res.error); }
*/
