# 세꼼 이메일 연동 가이드 (Resend + Netlify Functions)

> 목표: 세꼼이 OTP·결과·설문 감사 메일을 **안전하게** 보내기.
> 핵심 원칙: **Resend API 키는 절대 브라우저에 두지 않는다.** 키는 서버리스 함수(Netlify Functions)의 환경변수에만 저장하고, 프론트는 그 함수만 호출한다.

```
[세꼼 HTML]  →  POST /api/send-email  →  [Netlify 함수]  →  [Resend]  →  사용자 메일함
  (키 없음)                              (키는 여기 환경변수에만)
```

---

## 0. 이 폴더 구성

```
세꼼_이메일연동/
├─ netlify.toml                     ← 배포 설정(정적 + 함수)
├─ package.json                     ← @netlify/blobs 의존성
├─ netlify/functions/
│   ├─ send-email.js                ← 메일 발송(otp/result/survey_thanks/admin_lead)
│   ├─ verify-otp.js                ← OTP 검증
│   ├─ save-lead.js                 ← 설문·리드 서버 저장 (Netlify Blobs)
│   └─ list-leads.js                ← 관리자 리드 대시보드(토큰 보호)
├─ public/                          ← 여기에 세꼼 HTML을 index.html로 넣기
│   └─ index.html                   ← (세꼼_프로토타입_전체_v2.html 복사)
└─ 프론트_연결_스니펫.js            ← HTML에 붙일 호출 코드
```

> 정적 사이트(프로토타입)와 함수를 **한 폴더에서 같이 배포**합니다. 그래야 프론트가 같은 도메인의 `/api/...`로 키 없이 호출할 수 있어요.

---

## 1. Resend 가입 & API 키 (5분)

1. https://resend.com 가입 (무료 — 월 3,000통 / 하루 100통)
2. 좌측 **API Keys → Create API Key** → 권한 `Sending access` → 생성된 키 복사
   - `re_xxxxxxxx...` 형태. **이 키는 한 번만 보이니 안전한 곳에 복사**.

## 2. 발신자 인증 (도착률의 핵심)

### 방법 A — 도메인 인증 (정식 출시 권장)
1. Resend **Domains → Add Domain** → `sekkomi.com`(보유 도메인) 입력
2. Resend가 주는 **DNS 레코드(SPF·DKIM·DMARC)**를 도메인 등록기관 DNS에 추가
3. 인증 완료되면 `noreply@sekkomi.com`으로 발송 가능 → 스팸함 안 빠짐
4. 함수 환경변수 `MAIL_FROM` 을 `세꼼 <noreply@sekkomi.com>` 으로 설정

### 방법 B — 도메인 없이 베타 (지금 바로 테스트)
- Resend는 테스트용 발신 도메인 `onboarding@resend.dev` 를 제공해요.
- `MAIL_FROM` 을 `세꼼 <onboarding@resend.dev>` 로 두면 **본인에게 보내는 테스트**는 바로 됩니다.
- 단, 실제 사용자에게 대량 발송은 도착률이 낮으니 출시 전 방법 A로 전환하세요.

> **⚠️ gmail.com 주소를 From으로 쓸 수 없어요.** Resend는 우리가 **소유·인증한 도메인**에서만 발신할 수 있습니다. `sekkomi.com@gmail.com` 같은 지메일 주소를 `MAIL_FROM`(발신자)에 넣으면 Resend가 거부해요. 지메일은 **회신처(`REPLY_TO`)·관리자 수신처(`ADMIN_EMAIL`)** 로만 쓰고, 발신자는 반드시 인증 도메인(`noreply@sekkomi.com`) 또는 테스트 도메인(`onboarding@resend.dev`)을 사용하세요.
> - 도메인 인증 **전**: `MAIL_FROM = 세꼼 <onboarding@resend.dev>` (기본값)
> - 도메인 인증 **후**: `MAIL_FROM = 세꼼 <noreply@sekkomi.com>` 로 교체

## 3. Netlify 배포 + 환경변수

### (1) 배포
- **간단(드래그)**: 이 `세꼼_이메일연동` 폴더 전체를 Netlify 사이트의 Deploys에 드래그&드롭.
  - 단, `public/index.html`에 최신 세꼼 HTML을 넣어두세요.
- **권장(Git)**: 이 폴더를 GitHub에 올리고 Netlify에서 연결하면, 이후 수정 시 자동 배포됩니다.

### (2) 환경변수 설정 (키를 여기에만!)
Netlify 사이트 → **Site configuration → Environment variables → Add**:

| Key | Value | 설명 |
|-----|-------|------|
| `RESEND_API_KEY` | `re_xxxxx...` | 1번에서 복사한 키 (**필수**) |
| `MAIL_FROM` | `세꼼 <onboarding@resend.dev>` → 인증 후 `세꼼 <noreply@sekkomi.com>` | 발신자(From). **gmail 주소 불가 — 인증 도메인만** |
| `REPLY_TO` | `sekkomi.com@gmail.com` | (기본값 내장) 고객 메일 회신처. 고객이 답장하면 이 지메일로 옴 |
| `ADMIN_EMAIL` | `sekkomi.com@gmail.com` | (기본값 내장) 관리자 알림(admin_lead) 수신처 |
| `ALLOW_ORIGIN` | `https://sekkomi.com` | (선택) 우리 사이트만 호출 허용. 미설정 시 `*` |
| `ADMIN_TOKEN` | 아무 긴 문자열(예: `sk_admin_9x7...`) | **리드 대시보드 접근 암호**. 미설정 시 대시보드 전면 차단 |

> 환경변수 추가 후 **재배포(Trigger deploy)** 해야 적용돼요.

## 3.5 서버 저장 & 리드 대시보드 (Netlify Blobs)

- 설문·무료 이메일 응답이 **서버(Netlify Blobs)에 영속 저장**돼요. 브라우저 캐시를 지워도 안 사라지고, 여러 사용자 응답을 한곳에서 봐요.
  - 프론트가 자동 호출: 설문 제출 → `save-lead(kind:"survey")`, 무료 이메일 → `save-lead(kind:"free_email")`.
- **관리자 대시보드**: 배포 후 브라우저에서
  ```
  https://sekkomi.com/api/list-leads?token=<ADMIN_TOKEN>
  ```
  - 요약 카드(응답 수·평균 만족도·결제의향·세무사 연결 희망·적정가 중앙값) + 전체 표
  - `&format=csv` 붙이면 **엑셀용 CSV 다운로드**, `&format=json`이면 원본 JSON
  - `ADMIN_TOKEN` 없이는 접근 불가(401/503). **이 링크는 공유 금지.**

## 4. 프론트 연결

`프론트_연결_스니펫.js`의 `seggomMail()`·`seggomVerifyOtp()`를 세꼼 HTML `<script>`에 붙이고, 주석에 표시된 3곳에서 호출하세요.
- 결과 메일: 무료 이메일 수집 후 `seggomMail("result", email, {...})`
- 설문 감사: 설문 제출 성공 후 `seggomMail("survey_thanks", email)`
- OTP: 결제/로그인 흐름에서 `seggomMail("otp", email)` → `seggomVerifyOtp(email, code)`
- 관리자 알림(`admin_lead`): 설문 제출 시 프론트가 `seggomMail("admin_lead", "(아무거나)", { survey })` 호출. **수신처는 함수가 `ADMIN_EMAIL`로 강제**하므로 클라이언트가 보낸 `to`는 무시돼요(고객 메일과 별개로 관리자에게만 발송).

### type별 정리

| type | 수신처 | 내용 | reply_to |
|------|--------|------|----------|
| `otp` | 고객 | 6자리 인증번호 | `REPLY_TO` |
| `result` | 고객 | 양도세 결과 + 절세 시나리오 수(베타 무료) | `REPLY_TO` |
| `survey_thanks` | 고객 | 설문 감사 + 전체 무료 개방(+세무사 연결 안내) | `REPLY_TO` |
| `admin_lead` | **관리자(`ADMIN_EMAIL` 강제)** | 새 베타 설문/리드 알림(표 형태, 세무사 연결 희망자 강조) | — |

> `admin_lead`의 `data.survey` 필드: `satisfaction`(1~5), `vsOthers`, `liked`(배열), `buyIntent`, `fairPrice`(원), `taxConnect`(paid/free/later/no), `ageBand`, `email`, `freeText`, `context{addr,tax,scenarios}`. 코드값은 메일에서 한글 라벨로 변환되고, `taxConnect`가 `paid`/`free`(세무사 연결 희망)면 눈에 띄게 강조돼요.

> 로컬에서 파일로 열면 함수가 없으니 발송은 조용히 패스돼요(프로토타입은 그대로 동작). 실제 발송은 Netlify에 배포된 상태에서만 됩니다.

## 5. 빠른 테스트

배포 후 브라우저 콘솔이나 터미널에서:
```bash
curl -X POST https://<사이트>/api/send-email \
  -H "Content-Type: application/json" \
  -d '{"type":"otp","to":"본인메일@example.com"}'
# → {"ok":true} 이고 메일함에 6자리 코드 도착하면 성공
```
검증:
```bash
curl -X POST https://<사이트>/api/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"to":"본인메일@example.com","code":"받은코드"}'
# → {"ok":true}
```

---

## 6. 비용 & 한도

| 항목 | 무료 한도 | 초과 시 |
|------|----------|---------|
| Resend | 월 3,000통 / 일 100통 | 유료 플랜(월 $20~)으로 상향 |
| Netlify Functions | 월 125k 호출 | 무료로 베타 충분 |
| Netlify Blobs(OTP 저장) | 무료 티어 충분 | — |

베타 규모에선 **전부 무료**로 운영 가능해요.

## 7. 보안 체크리스트

- [x] API 키는 함수 환경변수에만 (HTML·깃 커밋 금지)
- [x] 임의 본문 발송 불가 — 정해진 템플릿(otp/result/survey_thanks/admin_lead)만
- [x] `admin_lead` 수신처는 `ADMIN_EMAIL`로 서버 강제(클라 `to` 무시)
- [x] 발신자(From)는 인증 도메인만 — gmail 주소 발신 불가(지메일은 reply_to/관리자 수신용)
- [x] OTP는 서버 생성·저장·검증, 응답에 코드 미포함, 5분 만료·5회 제한·1회용
- [x] 동일 이메일 1분 1회 레이트리밋
- [ ] (출시 전) `ALLOW_ORIGIN`을 실제 도메인으로 고정
- [ ] (출시 전) 도메인 인증(SPF/DKIM/DMARC) 완료

## 8. 다음 단계 (선택)

- **설문·리드 데이터 서버 저장**: 지금은 브라우저(localStorage)에만 남아요. 응답을 모아 분석하려면 함수에서 Netlify Blobs/DB(Supabase 등)에 저장하는 엔드포인트를 추가하면 됩니다. 원하시면 만들어드릴게요.
- **결제 연동**: OTP가 붙으면 그다음이 결제(토스페이먼츠/포트원). 별도 작업.
