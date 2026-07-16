# _parts — 대용량 파일 부분 커밋 조립소

`public/index.html`(223KB)은 자동화 도구의 단일 커밋 한도를 넘어, 이 폴더에 조각(part)으로 커밋한 뒤 조립합니다.

- `index.html.part01 ~ partNN`: 순서대로 이어붙이면 완성본
- `index.sha256`: 완성본 무결성 체크섬(sha256)

조립 방식: netlify.toml의 build command가 배포 시점에 `cat _parts/index.html.part* > public/index.html`로 조립합니다.

⚠️ 이 방식이 활성화된 동안에는 **앱 본체(index.html)의 배포 원본이 이 폴더**입니다. `public/index.html`을 직접 수정해도 배포에 반영되지 않습니다. 본체를 수정하려면 조각을 갱신하세요 (또는 이 폴더와 빌드 명령을 제거하고 public/index.html 직접 관리로 복귀).
