#!/usr/bin/env node
/**
 * build-blog-cards.cjs
 * -----------------------------------------------------------------------------
 * 블로그 목록(public/blog/index.html)에 "카드·ItemList가 없는 글"을 빌드 시점에 주입한다.
 *
 * 왜 필요한가 (2026-11-18 도입):
 *   index.html 이 커밋 도구(push_files)의 입력 한계 근처까지 커져서, 10/27 이후 신규 글 7편의
 *   카드·ItemList 를 커밋으로 넣지 못했다. build-theme·build-utm·build-noindex 와 같은 이유로
 *   "원본은 그대로 두고 빌드 산출물에만 주입"하는 방식으로 영구 해결한다.
 *
 * ⚠ 드리프트 주의 — 레포의 public/blog/index.html 은 라이브와 다르다.
 *   레포 파일에는 이 스크립트가 주입하는 카드·ItemList 항목이 없다. 라이브(빌드 산출물)에는 있다.
 *   무결성 4집합 대조는 클론에서 이 스크립트를 먼저 실행한 뒤의 index.html 로 해야 한다:
 *     node scripts/build-blog-cards.cjs   # 클론 사본에만 적용됨(커밋하지 말 것)
 *   신규 글 발행 시 index.html 을 커밋할 필요가 없다. 글 HTML + 사이트맵만 커밋한다.
 *
 * 무엇을 "빠진 글"로 보는가:
 *   public/blog/*.html 중 index.html 이 아니고, scripts/noindex-slugs.json 에 없고,
 *   ItemList 에 URL 이 없는 글.
 *
 * 카드 필드 출처 (글 HTML 에서 읽는다):
 *   h3·ItemList name = <h1> 텍스트 / p = meta description / th-cat·tag2 = BreadcrumbList position 2 이름
 *   날짜 = datePublished / 읽는 시간 = 본문 "읽는 시간 N분", 없으면 본문 한글 음절 수 ÷ 600 (최소 3분)
 *   600 은 2026-11-18 레포 실측 중앙값(읽는 시간이 적힌 글 70편)이다.
 *
 * 순서: 빠진 글을 datePublished 내림차순으로 시리즈 그리드(첫 번째 <div class="grid">) 맨 위에 넣고,
 *   ItemList 맨 앞에 같은 순서로 넣은 뒤 position 을 1~N 으로 재부여한다.
 *   build-blog-featured.cjs 보다 먼저 실행해야 featured 가 최신 글을 잡는다.
 *   build-llms-txt·build-rss 가 ItemList 기준이므로 그보다도 먼저다.
 *
 * 안전: 멱등(두 번 실행해도 결과 동일). 구조가 예상과 다르거나 글 하나라도 필드 파싱에 실패하면
 *   그 글은 건너뛰고 로그를 남긴다. 그리드·ItemList 를 못 찾으면 원본을 건드리지 않고 종료한다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BLOG = path.join(ROOT, 'public', 'blog');
const INDEX = path.join(BLOG, 'index.html');
const NOINDEX = path.join(ROOT, 'scripts', 'noindex-slugs.json');
const SITE = 'https://sekkomi.com';
const HANGUL_PER_MIN = 600;

const esc = (t) => String(t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stripTags = (t) => String(t).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const decodeEntities = (t) => String(t)
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function loadNoindex() {
  try {
    const j = JSON.parse(fs.readFileSync(NOINDEX, 'utf8'));
    const arr = Array.isArray(j) ? j : (j.slugs || []);
    return new Set(arr.map(String));
  } catch (e) {
    console.log('[build-blog-cards] noindex-slugs.json 읽기 실패 — 안전을 위해 종료:', e.message);
    return null;
  }
}

function parsePost(slug) {
  const s = fs.readFileSync(path.join(BLOG, slug + '.html'), 'utf8');
  const h1m = s.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const descm = s.match(/<meta name="description" content="([^"]*)"/);
  const datem = s.match(/"datePublished"\s*:\s*"(\d{4})-(\d{2})-(\d{2})/);
  let cat = null;
  const bcm = s.match(/"@type"\s*:\s*"BreadcrumbList"[\s\S]*?"position"\s*:\s*2\s*,\s*"name"\s*:\s*"([^"]+)"/);
  if (bcm) cat = bcm[1];
  if (!h1m || !descm || !datem || !cat) {
    return { error: `필드 누락 h1=${!!h1m} desc=${!!descm} date=${!!datem} cat=${!!cat}` };
  }
  let minutes;
  const rm = s.match(/읽는 시간 (\d+)분/);
  if (rm) {
    minutes = Number(rm[1]);
  } else {
    const a = s.indexOf('<article>');
    const b = s.lastIndexOf('</article>');
    const body = a >= 0 && b > a ? s.slice(a, b) : s;
    const n = (stripTags(body).match(/[가-힣]/g) || []).length;
    minutes = Math.max(3, Math.round(n / HANGUL_PER_MIN));
  }
  const [, y, mo, d] = datem;
  return {
    slug,
    title: decodeEntities(stripTags(h1m[1])),
    desc: decodeEntities(descm[1]),
    cat: decodeEntities(cat),
    iso: `${y}-${mo}-${d}`,
    label: `${y}.${Number(mo)}.${Number(d)}`,
    minutes,
  };
}

function cardHtml(p) {
  return (
`    <a class="card" href="/blog/${p.slug}">
      <div class="thumb" style="background:linear-gradient(135deg,#1e2f2a,#08140f)">
        <div class="th-ep">GUIDE</div>
        <div class="th-cat">${esc(p.cat)}</div>
      </div>
      <div class="c-body">
        <span class="tag2">${esc(p.cat)}</span>
        <h3>${esc(p.title)}</h3>
        <p>${esc(p.desc)}</p>
        <div class="c-meta">세꼼이 · ${p.label} · ${p.minutes}분</div>
      </div>
    </a>
`);
}

function main() {
  const noindex = loadNoindex();
  if (!noindex) return;

  let html = fs.readFileSync(INDEX, 'utf8');

  // ItemList JSON-LD 찾기
  const ldRe = /(<script type="application\/ld\+json">)([^<]*"@type"\s*:\s*"ItemList"[^<]*)(<\/script>)/;
  const ldm = html.match(ldRe);
  if (!ldm) { console.log('[build-blog-cards] ItemList 없음 — 변경 없이 종료'); return; }
  let ld;
  try { ld = JSON.parse(ldm[2]); } catch (e) {
    console.log('[build-blog-cards] ItemList 파싱 실패 — 변경 없이 종료'); return;
  }
  if (!Array.isArray(ld.itemListElement)) { console.log('[build-blog-cards] itemListElement 없음 — 종료'); return; }

  const GRID = '<div class="grid">\n';
  const gi = html.indexOf(GRID);
  if (gi < 0) { console.log('[build-blog-cards] 시리즈 그리드 없음 — 변경 없이 종료'); return; }

  const inList = new Set(ld.itemListElement.map((it) => String(it.url || '').replace(SITE + '/blog/', '')));
  const slugs = fs.readdirSync(BLOG)
    .filter((f) => f.endsWith('.html') && f !== 'index.html')
    .map((f) => f.slice(0, -5));

  const missing = [];
  for (const slug of slugs) {
    if (noindex.has(slug) || inList.has(slug)) continue;
    if (html.includes(`href="/blog/${slug}"`)) {
      console.log(`[build-blog-cards] ${slug}: 카드는 있고 ItemList 만 없음 — 건너뜀(수동 확인 필요)`);
      continue;
    }
    const p = parsePost(slug);
    if (p.error) { console.log(`[build-blog-cards] ${slug}: ${p.error} — 건너뜀`); continue; }
    missing.push(p);
  }

  if (!missing.length) { console.log('[build-blog-cards] 빠진 글 없음 — 변경 없음'); return; }

  missing.sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : a.slug.localeCompare(b.slug)));

  // 1) 카드: 시리즈 그리드 맨 위
  const insertAt = gi + GRID.length;
  html = html.slice(0, insertAt) + missing.map(cardHtml).join('') + html.slice(insertAt);

  // 2) ItemList: 맨 앞에 추가 후 position 재부여
  const added = missing.map((p) => ({ '@type': 'ListItem', position: 0, url: `${SITE}/blog/${p.slug}`, name: p.title }));
  ld.itemListElement = added.concat(ld.itemListElement);
  ld.itemListElement.forEach((it, i) => { it.position = i + 1; });
  html = html.replace(ldRe, (_, a, __, c) => a + '\n' + JSON.stringify(ld) + '\n' + c);

  fs.writeFileSync(INDEX, html);
  console.log(`[build-blog-cards] 주입 ${missing.length}편: ${missing.map((p) => `${p.slug}(${p.iso},${p.minutes}분)`).join(', ')} · ItemList ${ld.itemListElement.length}`);
}

main();
