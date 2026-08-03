# 세꼼이 숏폼(릴스) 렌더 템플릿

`claude/숏폼-제작-기준.md` 포맷 기준을 그대로 구현한 템플릿이다.
clone + `npm i` 두 단계면 무인(headless) 클라우드 실행에서도 릴스를 재현할 수 있다.
렌더 시 CDN·네트워크 의존 없음 (자산은 전부 로컬 상대경로).

```
tools/shortform/
  sekkomi_shortform_template.html   # 4카드 템플릿 + GSAP 타임라인 (여기 텍스트만 교체)
  render.py                         # Playwright 프레임 캡처 → ffmpeg 인코딩
  package.json / package-lock.json  # gsap + pretendard 버전 핀 (integrity 해시 포함)
  README.md / .gitignore
  --- 아래는 커밋하지 않음, npm 으로 복원됨 ---
  gsap.min.js                       # node_modules/gsap/dist 에서 복원 (sha256 검증)
  fonts/Pretendard-*.otf            # node_modules/pretendard 에서 복원
  frames/                           # 렌더 중간 PNG, 매 실행 재생성
  *.mp4                             # 산출물
```

**용량이 큰 바이너리·번들은 레포에 넣지 않는다.** `fonts/`(Pretendard OTF 7.6MB),
`gsap.min.js`(73KB), 산출물 `*.mp4` 는 전부 `package-lock.json` 에 핀된 npm 패키지에서
바이트 동일하게 복원된다 (원본과 sha256 일치 확인함). `render.py` 가 매 실행 시작 시
자동으로 복원·검증하므로 아래 `npm i` 만 해두면 된다.

---

## 0. 세팅 — 새 컨테이너에서 그대로 복붙

```bash
git clone --depth 1 https://github.com/MyungwooLEE/sekkomi.git
cd sekkomi/tools/shortform
```

### 1단계 — Playwright 환경변수 (필수, 매 셸마다)

```bash
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
```

> **`playwright install` 은 절대 실행하지 말 것.** 브라우저는 이미 `/opt/pw-browsers` 에
> 프로비저닝되어 있다. `install` 은 네트워크에서 새로 받으려다 실패하거나, 받더라도
> 다른 경로에 깔려 런타임이 못 찾는다. `render.py` 도 이 두 변수를 `setdefault` 로 넣지만,
> 셸에서 먼저 export 해두는 쪽이 안전하다.

### 2단계 — 의존물 복원 (폰트 + GSAP)

```bash
npm i
mkdir -p fonts
cp node_modules/pretendard/dist/public/static/Pretendard-{Medium,SemiBold,Bold,ExtraBold,Black}.otf fonts/
cp node_modules/gsap/dist/gsap.min.js .
```

템플릿의 `@font-face` 가 `./fonts/Pretendard-*.otf` 상대경로를, `<script>` 가 `./gsap.min.js` 를
참조하므로 위 복사가 **정본**이다.
필요한 weight 는 5개 — Medium(500) / SemiBold(600) / Bold(700) / ExtraBold(800) / Black(900).

시스템 폰트로도 등록하고 싶으면 (선택, headless 렌더에는 불필요):

```bash
mkdir -p ~/.fonts
cp node_modules/pretendard/dist/public/static/Pretendard-*.otf ~/.fonts/
fc-cache -f
```

`render.py` 는 시작 시 `fonts/` 를 검사해서, 없으면 `node_modules/pretendard/dist/public/static/`
에서 자동 복사한다. `npm i` 조차 안 되어 있으면 조용히 폴백 폰트로 렌더하지 않고 **즉시 실패**한다.

`gsap.min.js` 도 같은 방식으로 `node_modules/gsap/dist/` 에서 복원하되, sha256 이
`gsap@3.15.0` 정본(`92bb9a96…570fbb`)과 일치하는지까지 검증한다.
따라서 위 `cp` 두 줄을 깜빡해도 `npm i` 만 되어 있으면 렌더는 항상 정상 자산으로 실행된다.

> 정리하면 **실제로 꼭 필요한 건 `npm i` 뿐**이고, `cp` 두 줄은 명시적으로 해두는 쪽이
> 디버깅에 편해서 적어둔 것이다.

### 3단계 — 렌더

```bash
python3 render.py --out sekkomi_v7_소재명.mp4
# 다른 HTML 로: python3 render.py --html sekkomi_v7.html --out sekkomi_v7.mp4
```

산출물은 `tools/shortform/sekkomi_v7_소재명.mp4` — 1080×1920 / 30fps / H.264(yuv420p) /
정확히 19.0초 570프레임, 대략 1.2MB. 소요 약 2분. **mp4 는 커밋하지 않는다.**

동작: 이 폴더를 `127.0.0.1:8765` 로 서빙 → Playwright 로 열고 `window.__ready` 대기 →
`window.frameAt(i/30)` 으로 570프레임을 결정적으로 캡처 (`frames/00000.png` …) →
ffmpeg `-crf 18 -pix_fmt yuv420p -movflags +faststart` 인코딩.
페이지에서 JS 에러가 하나라도 나면 캡처 전에 중단된다.

---

## 포맷 스펙 (고정 — 바꾸지 말 것)

| 항목 | 값 |
|---|---|
| 해상도 | **1080×1920** (9:16) |
| 프레임레이트 | **30fps** |
| 길이 | **정확히 19.0초** = 570프레임 |
| 카드 경계 | `T = {c1:0, c2:4.9, c3:9.7, c4:14.6, end:19.0}` |
| 홀드 | 카드1~3 약 2초, CTA 카드 3초 |
| 컬러 | `--green #163300` / `--lime #9FE870` / `--off #F7F5EF` |
| 코덱 | H.264 / yuv420p / crf 18 / +faststart |

전환: 세로 와이프(→카드2) → 좌우 스플릿(→카드3) → 줌펀치+플래시(→카드4).
카드마다 1.045→1 줌아웃 settle, 상단 라임 진행바(19초 전체).

---

## 새 소재로 교체하는 방법

`sekkomi_shortform_template.html` 의 `CONTENT SWAP ZONE` 주석 사이에 있는
네 개의 `<section class="card">` **안 텍스트만** 바꾼다.
**클래스명·id(`#c1`~`#c4`)·DOM 구조는 그대로 둘 것** — 타임라인이 클래스 셀렉터 기준으로
자동 동작하므로, 클래스를 바꾸면 해당 요소가 애니메이션에서 통째로 빠진다.

| 카드 | 클래스 | 규칙 |
|---|---|---|
| 1 훅 | `.hook-line` | 줄 수만큼 0.3초 간격 순차 등장. 강조 단어는 `<span class="em"><i class="hlbar"></i><span class="hltext">단어</span></span>` 로 감싸면 라임 형광펜 스윕 + 색반전 자동 적용 |
| 2 핵심 | `.big`, `.chip`, `.chip.x` | `.big` 팝 후 `.chip` 이 0.25초 간격 순차 팝. `.chip`=솔리드(긍정), `.chip.x`=아웃라인(부정). 칩 4개 권장(최대 5개) |
| 3 대비 | `.lose`(8자 이내), `.win`, `.note` | `.lose` 안의 `<i class="strike">` 가 취소선, `.win` 안의 `.hl` 이 라임 형광펜 블록 |
| 4 CTA | `.wordmark`, `.headline`, `.sub`, `.btn`, `.cta-footer` | `.btn` 은 홀드 3초 내내 펄스 |

숫자 카운트업이 필요하면 `window.sekkomiCountTo(el, from, to, at, dur)` 를 쓴다 (아래 규칙 3 참고).

문구 길이만 바뀌는 경우 타이밍은 손대지 않아도 된다.
칩 개수를 늘렸다면 마지막 칩이 `T.c3 - 2.0` 이전에 끝나는지만 확인할 것.

---

## 건드리면 깨지는 것들 (실측 버그 — 반드시 지킬 것)

1. **모든 `fromTo` 에 `immediateRender:false` 필수.**
   없으면 GSAP 이 빌드 시점에 끝상태를 즉시 렌더해 화이트아웃이 난다.

2. **등장 트윈은 `from` 상태를 t=0 에 `set` 으로 한 번 더 고정해야 한다.**
   `immediateRender:false` 만 쓰면 트윈 시작 전 구간에서 요소가 CSS 기본상태(=보임)로
   노출돼 일찍 깜빡인다. 그래서 `appear(target, fromVars, toVars, at)` 헬퍼가
   `tl.set(target, fromVars, 0)` 을 먼저 박고 `fromTo` 를 건다.
   **직접 `fromTo` 를 추가하지 말고 항상 `appear()` 를 쓸 것.**
   (추가로 빌드 직후 `clearProps:'all'` 로 전체 초기화 — chip/hlbar/hltext 포함.)

3. **`textContent` 는 절대 트윈하지 말 것.**
   GSAP 이 문자열을 숫자로 해석하려다 타임라인 전체가 멈춘다.
   반드시 프록시 객체 + `onUpdate` 방식(`{v:from}` → `onUpdate(){ el.textContent = ... }`)을 쓴다.
   `window.sekkomiCountTo()` 가 이 패턴의 헬퍼다.

4. **GSAP 은 "현재 시간과 같은 시간"으로 seek 하면 렌더를 건너뛴다.**
   그래서 0프레임이 t=0 상태가 아니라 원본 CSS 로 찍힌다.
   `window.frameAt(t)` 가 `t <= 0` 일 때 `1e-4` 만큼 밀어서 이걸 막는다.
   **캡처는 반드시 `frameAt()` 경유** — `tl.seek()` 직접 호출 금지.

5. **버튼 펄스에 `repeat:-1` 금지.**
   무한 반복은 타임라인 duration 을 무한대로 만들어 seek 기반 캡처가 불가능해진다.
   유한 반복(`repeat:5`)을 쓸 것.

6. 마스터 타임라인은 `paused:true` 하나만 — 실시간 재생 캡처 금지 (프레임 드롭 = 길이 흔들림).

---

## 함께 나가야 하는 것

영상 1개 = 캡션 세트 1개가 완성본이다. 캡션·해시태그·커버·고정댓글 규칙은
`claude/숏폼-제작-기준.md` 의 "업로드 세트" 절을 따른다.

## 배포 영향 없음

`netlify.toml` 의 `publish = "public"` 이라 `tools/` 이하는 사이트로 배포되지 않는다.
