# _parts — 앱 본체 조립소 + 빌드 주입 원본

이 폴더는 **배포되지 않는다**(`netlify.toml`의 `publish = "public"`). 빌드 입력 전용이다.

## 1. 앱 본체 조각 (index.html.part01~06)

`public/index.html`은 자동화 도구의 단일 커밋 한도를 넘어, 조각으로 커밋한 뒤 배포 시점에 조립한다.

- `index.html.part01 ~ partNN` — 순서대로 이어붙이면 완성본
- `index.sha256` — 완성본 무결성 체크섬. **조각을 고치면 반드시 같이 갱신**한다. 안 맞으면 빌드가 실패하고 기존 배포가 유지된다(설계된 안전장치).

⚠ **앱 본체의 배포 원본은 이 폴더다.** `public/index.html`을 직접 고쳐도 배포에 반영되지 않는다.

⚠ **레포에 커밋된 `public/index.html`은 최신이 아니다** (2026-08-13 확인 시점 기준 8/11 이전 버전). 빌드가 매번 덮어쓰므로 운영에는 문제가 없지만, **레포의 그 파일을 읽고 현재 사이트 상태를 판단하지 말 것.** 현재 상태를 보려면 조각을 직접 조립하라:

```
cat _parts/index.html.part* > /tmp/now.html
```

## 2. 빌드 주입 원본 (2026-08-13 신설)

`scripts/build-landing.cjs`가 조립 **이후** 아래 두 파일을 결과물에 끼워 넣는다.

| 파일 | 주입 대상 | 내용 |
|---|---|---|
| `landing-below.html` | `public/index.html` 의 랜딩(#s01) 하단 | 케이스 비교·세율표·장특공·FAQ(FAQPage 스키마)·CTA·관련글 + PC 와이드 CSS |
| `blog-banner.html` | `public/blog/index.html` 의 히어로 아래 | 계산기 CTA 배너 |

**랜딩 하단을 고치려면 `landing-below.html`을 고친다.** `index.html.part*`도, `public/index.html`도 아니다.

왜 이렇게 하나: 랜딩 마크업이 있는 `part02`는 40KB가 넘고 한글 비중이 높아, 자동화 도구로 통째 재업로드하면 전사 오류가 난다(2026-08-11 실제 발생). 본체 조각을 건드리지 않는 편이 안전하다.

주의사항:
- `build-landing.cjs`는 기존 `.lp-foot`(히어로 안의 푸터) 블록을 **들어내고** `landing-below.html` 끝의 푸터로 대체한다. 둘 중 하나만 고치면 푸터가 사라지거나 중복된다.
- 주입은 멱등이다(마커 클래스 `lx-wrap`·`lxb-in` 존재 시 건너뜀). 앵커를 못 찾으면 조용히 통과하므로 **빌드는 성공하는데 섹션만 안 붙는** 상태가 될 수 있다. 본체 랜딩 마크업을 고쳤다면 배포 후 실제 페이지에서 섹션 존재를 확인할 것.
- 조각 조립과 달리 이 단계에는 체크섬 검증이 없다.

## 3. 본체 수정 시 권장 절차

1. 조각을 고치고 `index.sha256` 갱신
2. 로컬에서 `cat _parts/index.html.part* > /tmp/x.html` 후 `sha256sum -c` 로 자가 검증
3. 인라인 `<script>` 는 `node --check` 로 구문 검사
4. 푸시 후 **새로 clone 해서 sha256 대조** — 도구 전사 오류를 여기서 잡는다
