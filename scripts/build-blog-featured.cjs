#!/usr/bin/env node
/**
 * build-blog-featured.cjs
 * -----------------------------------------------------------------------------
 * 블로그 목록(public/blog/index.html)의 큰 featured(히어로) 카드를
 * "시리즈 그리드의 맨 위 카드 = 가장 최근 발행글"로 자동 동기화한다.
 *
 * 자기완결형(idempotent): 배포(Netlify 빌드) 때마다 실행되며, 필요한 스타일과
 * EP.01 보존 카드까지 없으면 스스로 주입한 뒤 featured를 최신글로 맞춘다.
 * 그래서 새 글은 지금까지처럼 시리즈 그리드 맨 위에 카드만 추가하면,
 * featured 블록을 손으로 고칠 필요가 전혀 없다.
 *
 * 단계:
 *   1) 그라데이션 커버용 CSS가 없으면 주입 (.feat-cover / .fc-ep / .fc-cat / .card.is-feat)
 *   2) 원래 featured 전용이던 EP.01(1주택 비과세) 카드가 그리드에 없으면 보존 카드로 추가
 *   3) 모든 카드의 is-feat 표시 초기화
 *   4) 시리즈 그리드 첫 카드(최신글)를 파싱해 featured를 그라데이션 커버로 재생성·교체
 *   5) featured로 올라간 첫 카드는 그리드에서 숨겨(is-feat) 중복 노출 방지
 *
 * 파싱/구조가 예상과 다르면 원본을 건드리지 않고 그대로 종료(빌드 안전).
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'blog', 'index.html');

// 1) 그라데이션 커버 CSS 주입 (없을 때만)
function ensureCss(html) {
  if (html.includes('.feat .feat-cover')) return html;
  const anchor = '  @media(min-width:680px){.feat{grid-template-columns:1.1fr 1fr}.feat img{aspect-ratio:auto;height:100%}}';
  if (!html.includes(anchor)) return html; // 구조 다르면 스킵
  const injected =
`  .feat .feat-cover{aspect-ratio:1200/630;display:flex;flex-direction:column;justify-content:flex-end;padding:26px 28px;color:var(--cream)}
  .feat .fc-ep{font-weight:800;font-size:13px;color:var(--lime);letter-spacing:1.5px}
  .feat .fc-cat{font-weight:800;font-size:34px;color:#fff;letter-spacing:-.5px;margin-top:6px;line-height:1.12}
  .card.is-feat{display:none}
  @media(min-width:680px){.feat{grid-template-columns:1.1fr 1fr}.feat img,.feat .feat-cover{aspect-ratio:auto;height:100%;min-height:240px}}`;
  return html.replace(anchor, injected);
}

// 2) EP.01 보존 카드 주입 (그리드에 없을 때만) — EP.00 다음, EP.02 앞
function ensureEp01Card(html) {
  if (html.includes('<div class="th-ep">EP.01</div>')) return html;
  const anchor = '    <a class="card" href="/blog/dajutaek-yangdose-junggwa-2026">';
  if (!html.includes(anchor)) return html;
  const card =
`    <a class="card" href="/blog/1sedae-1jutaek-bigwase-jogeon">
      <div class="thumb" style="background:linear-gradient(135deg,#1e4a00,#0e2200)">
        <div class="th-ep">EP.01</div>
        <div class="th-cat">1주택 비과세</div>
      </div>
      <div class="c-body">
        <span class="tag2">비과세</span>
        <h3>1세대 1주택 비과세 조건, 3가지만 알면 됩니다 (2026)</h3>
        <p>보유·거주 2년, 12억 기준까지 — 집 팔 때 양도세 0원 만드는 4가지 요건을 쉽게 정리했어요.</p>
        <div class="c-meta">세꼼이 · 2026.7.7 · 4분</div>
      </div>
    </a>
`;
  return html.replace(anchor, card + anchor);
}

function main() {
  let html = fs.readFileSync(FILE, 'utf8');

  html = ensureCss(html);
  html = ensureEp01Card(html);

  // 3) 초기화: 모든 카드에서 is-feat 제거
  html = html.replace(/<a class="card is-feat"/g, '<a class="card"');

  // 4) 시리즈 그리드의 첫 카드(최신글) 찾기
  const m = html.match(/<a class="card" href="([^"]+)">([\s\S]*?)<\/a>/);
  if (!m) {
    console.log('[build-blog-featured] .card 없음 — 변경 없이 종료');
    return;
  }
  const href = m[1];
  const inner = m[2];

  const pick = (re, d = '') => {
    const x = inner.match(re);
    return x ? x[1].trim() : d;
  };
  const grad  = pick(/<div class="thumb" style="background:([^"]+)">/);
  const ep    = pick(/<div class="th-ep">([\s\S]*?)<\/div>/);
  const cat   = pick(/<div class="th-cat">([\s\S]*?)<\/div>/);
  const tag   = pick(/<span class="tag2">([\s\S]*?)<\/span>/);
  const title = pick(/<h3>([\s\S]*?)<\/h3>/);
  const desc  = pick(/<div class="c-body">[\s\S]*?<p>([\s\S]*?)<\/p>/);
  const meta  = pick(/<div class="c-meta">([\s\S]*?)<\/div>/);

  if (!grad || !title) {
    console.log('[build-blog-featured] 카드 파싱 실패 — 변경 없이 종료');
    return;
  }

  // featured 카드 재생성 (그라데이션 커버)
  const feat =
`<a class="feat" href="${href}">
      <div class="feat-cover" style="background:${grad}">
        <div class="fc-ep">${ep}</div>
        <div class="fc-cat">${cat}</div>
      </div>
      <div class="body">
        <span class="tag">${tag}</span>
        <h2>${title}</h2>
        <p>${desc}</p>
        <div class="go">글 읽기 →</div>
        <div class="meta">${meta}</div>
      </div>
    </a>`;

  if (!/<a class="feat"[\s\S]*?<\/a>/.test(html)) {
    console.log('[build-blog-featured] .feat 블록 없음 — 변경 없이 종료');
    return;
  }
  html = html.replace(/<a class="feat"[\s\S]*?<\/a>/, feat);

  // 5) featured로 올라간 첫 카드는 그리드에서 숨겨 중복 노출 방지
  html = html.replace(/<a class="card" href="/, '<a class="card is-feat" href="');

  fs.writeFileSync(FILE, html);
  console.log(`[build-blog-featured] featured = ${href}  (${title})`);
}

main();
