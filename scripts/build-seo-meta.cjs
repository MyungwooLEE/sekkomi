#!/usr/bin/env node
/**
 * build-seo-meta.cjs
 * -----------------------------------------------------------------------------
 * 배포 때마다 public/blog/*.html 에 노출 확장용 메타를 자동 주입한다.
 * 새 글을 쓸 때 아무것도 신경 쓸 필요가 없도록, 발행 세트(4점)는 그대로 두고
 * 여기서 일괄 보정한다.
 *
 * 하는 일 네 가지:
 *   1) robots 메타 주입 — max-image-preview:large 등
 *      구글 디스커버는 '큰 이미지 카드'로만 노출되는데, 이 지시자가 없으면
 *      썸네일 크기로 제한돼 사실상 디스커버 후보에서 빠진다. 47편 중 0편이
 *      갖고 있던 상태라 이 한 줄이 디스커버 진입의 선결 조건이다.
 *   2) RSS 대체 링크 주입 — <link rel="alternate" type="application/rss+xml">
 *   3) og:image 자동 교체 — 릴스 파이프라인이 만든 글 전용 OG 카드
 *      (public/reels/<id>_og.jpg) 가 있으면 og:image·twitter:image 를 그것으로
 *      바꾼다. 슬러그 매칭은 큐 JSON 의 blog_url 로 한다(릴스 id 와 글 슬러그가
 *      다르기 때문). 없으면 기존 이미지를 그대로 둔다.
 *   4) meta description 80자 보정 (2026-08-12 추가)
 *      네이버 서치어드바이저가 80자 이내를 권장하고, 구글도 한글 기준 70~80자를
 *      넘으면 SERP 에서 잘라낸다. 초과분은 뒷부분이 아예 안 보이므로 양쪽 모두
 *      손해다. 기존 51편 중 47편이 80자를 넘겨(중앙값 102자·최대 221자) 사람이
 *      직접 다시 쓴 문구를 scripts/blog-descriptions.json 에 담고 여기서 주입한다.
 *
 *      ★ 덮어쓰기 조건: 슬러그가 맵에 있고 AND 현재 HTML 의 description 이
 *        80자를 넘을 때만 교체한다. 나중에 누군가 글 HTML 의 description 을
 *        80자 이내로 직접 고치면 맵이 조용히 무시되므로 footgun 이 없다.
 *      ★ 새 글은 맵에 추가하지 말 것. 발행 시점에 80자 이내로 쓰면 된다
 *        (운영 규칙 §1 참조). 맵은 기존 47편을 위한 일회성 보정 장치다.
 *
 * 안전 원칙(다른 build-*.cjs 와 동일):
 * - 자기완결형(idempotent) — 여러 번 실행해도 중복 주입되지 않는다
 * - 어떤 오류가 나도 원본을 건드리지 않고 조용히 종료 (빌드 절대 안 깸)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BLOG = path.join(ROOT, 'public', 'blog');
const QUEUE = path.join(ROOT, 'tools', 'shortform', 'queue');
const REELS = path.join(ROOT, 'public', 'reels');
const DESCFILE = path.join(__dirname, 'blog-descriptions.json');

const DESC_MAX = 80;

// 손으로 다시 쓴 description 맵. 파일이 없거나 깨졌으면 이 단계만 조용히 건너뛴다.
function loadDescMap() {
  try {
    if (!fs.existsSync(DESCFILE)) return {};
    const j = JSON.parse(fs.readFileSync(DESCFILE, 'utf8'));
    return (j && typeof j === 'object') ? j : {};
  } catch (e) {
    console.log('[build-seo-meta] blog-descriptions.json 읽기 실패 — description 보정 생략: ' + (e && e.message));
    return {};
  }
}

// 속성값으로 안전하게 넣기 위한 최소 이스케이프
function attrEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// HTML 엔티티를 되돌려 실제 표시 길이를 센다 (&#x27; 등이 1자로 세어지도록)
function decodeEntities(s) {
  return String(s)
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const ROBOTS = '<meta name="robots" content="max-image-preview:large, max-snippet:-1, max-video-preview:-1">';
const RSSLINK = '<link rel="alternate" type="application/rss+xml" title="세꼼이 블로그" href="https://sekkomi.com/rss.xml">';

// 큐 JSON 의 blog_url 로 슬러그 -> 릴스 id 매핑을 만든다
function slugToReelId() {
  const map = {};
  try {
    if (!fs.existsSync(QUEUE)) return map;
    for (const f of fs.readdirSync(QUEUE)) {
      if (!f.endsWith('.json') || f === 'queue.json') continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(QUEUE, f), 'utf8'));
        const url = j && j.blog_url;
        if (!url) continue;
        const slug = String(url).split('/blog/')[1];
        if (slug) map[slug.replace(/\/$/, '')] = f.replace(/\.json$/, '');
      } catch (e) { /* 이 큐 항목만 건너뜀 */ }
    }
  } catch (e) { /* 매핑 없이 진행 */ }
  return map;
}

function injectOnce(html, needle, snippet, anchorRe) {
  if (html.includes(needle)) return html;
  const m = html.match(anchorRe);
  if (!m) return html;
  return html.replace(anchorRe, m[0] + '\n' + snippet);
}

function main() {
  try {
    if (!fs.existsSync(BLOG)) {
      console.log('[build-seo-meta] blog 디렉터리 없음 — 종료');
      return;
    }
    const map = slugToReelId();
    const descMap = loadDescMap();
    let touched = 0, ogSwapped = 0, sharedHero = [];
    let descFixed = 0, descSkipped = [], descStillLong = [];

    for (const file of fs.readdirSync(BLOG)) {
      if (!file.endsWith('.html')) continue;
      const slug = file.replace(/\.html$/, '');
      const full = path.join(BLOG, file);
      let html;
      try { html = fs.readFileSync(full, 'utf8'); } catch (e) { continue; }
      const before = html;

      // 1) robots 메타 — canonical 바로 뒤에 붙인다
      html = injectOnce(html, 'max-image-preview', ROBOTS,
        /<link rel="canonical"[^>]*>/);

      // 2) RSS 대체 링크 — canonical 뒤
      html = injectOnce(html, 'application/rss+xml', RSSLINK,
        /<link rel="canonical"[^>]*>/);

      // 3) og:image 교체 (글 전용 OG 카드가 있을 때만)
      const reelId = map[slug];
      if (reelId) {
        const ogFile = path.join(REELS, reelId + '_og.jpg');
        if (fs.existsSync(ogFile)) {
          const ogUrl = 'https://sekkomi.com/reels/' + reelId + '_og.jpg';
          if (!html.includes(ogUrl)) {
            html = html.replace(/(<meta property="og:image" content=")[^"]*(")/, '$1' + ogUrl + '$2');
            if (/<meta name="twitter:image"/.test(html)) {
              html = html.replace(/(<meta name="twitter:image" content=")[^"]*(")/, '$1' + ogUrl + '$2');
            } else {
              html = html.replace(/<meta name="twitter:card"[^>]*>/,
                m => m + '\n<meta name="twitter:image" content="' + ogUrl + '">');
            }
            if (html.includes(ogUrl)) ogSwapped++;
          }
        }
      }

      // 4) meta description 80자 보정
      if (slug !== 'index') {
        const dm = html.match(/<meta name="description" content="([^"]*)">/);
        if (dm) {
          const curLen = decodeEntities(dm[1]).length;
          const replacement = descMap[slug];
          if (replacement && curLen > DESC_MAX) {
            const newLen = decodeEntities(replacement).length;
            if (newLen > DESC_MAX) descStillLong.push(slug + '(' + newLen + '자)');
            html = html.replace(dm[0],
              '<meta name="description" content="' + attrEscape(replacement) + '">');
            descFixed++;
          } else if (curLen > DESC_MAX) {
            // 맵에 없는데 80자를 넘는 글 — 새 글이 규칙을 어긴 경우다. 고치지 않고 알린다.
            descSkipped.push(slug + '(' + curLen + '자)');
          }
        }
      }

      // 진단: 공유 히어로 이미지를 그대로 쓰는 글 목록 (디스커버 불리)
      if (slug !== 'index' && html.includes('assets/hero_1sedae.png')) sharedHero.push(slug);

      if (html !== before) {
        fs.writeFileSync(full, html, 'utf8');
        touched++;
      }
    }

    console.log('[build-seo-meta] 메타 주입 ' + touched + '개 파일 · OG 이미지 교체 ' + ogSwapped +
      '건 · description 80자 보정 ' + descFixed + '건');
    if (descStillLong.length) {
      console.log('[build-seo-meta] ⚠ 교체했는데도 80자 초과인 항목 — blog-descriptions.json 수정 필요: ' +
        descStillLong.join(', '));
    }
    if (descSkipped.length) {
      console.log('[build-seo-meta] ⚠ description 80자 초과인데 맵에 없는 글 ' + descSkipped.length +
        '편 — 발행 시 80자 이내로 쓸 것: ' + descSkipped.join(', '));
    }
    if (sharedHero.length) {
      console.log('[build-seo-meta] 공유 히어로(hero_1sedae.png) 사용 글 ' + sharedHero.length +
        '편 — 디스커버 노출에 불리, 순차 교체 대상: ' + sharedHero.slice(0, 8).join(', ') +
        (sharedHero.length > 8 ? ' 외 ' + (sharedHero.length - 8) + '편' : ''));
    }
  } catch (e) {
    console.log('[build-seo-meta] 오류 — 변경 없이 종료: ' + (e && e.message));
  }
}

main();
