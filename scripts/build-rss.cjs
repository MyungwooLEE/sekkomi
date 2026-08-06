#!/usr/bin/env node
/**
 * build-rss.cjs
 * -----------------------------------------------------------------------------
 * public/blog/index.html 의 ItemList JSON-LD 를 파싱해 public/rss.xml 을 생성한다.
 *
 * 왜 필요한가: RSS 자체의 직접 유입은 작지만, 외부 배포 자동화의 '배관'이다.
 * 뉴스 애그리게이터 수집, 스레드/X 자동 게시 트리거, 뉴스레터 자동 발행이
 * 전부 RSS 를 소스로 삼는다. 채널을 늘릴 때마다 파서를 새로 만들지 않아도 된다.
 *
 * build-llms-txt.cjs 와 동일한 안전 원칙:
 * - 배포 때마다 실행되는 자기완결형(idempotent) 스크립트
 * - 어떤 오류가 나도 기존 rss.xml 을 건드리지 않고 조용히 종료 (빌드 절대 안 깸)
 * - 새 글 발행 시 별도 작업 불필요 — blog/index.html 의 ItemList 만 갱신되면 따라온다
 *
 * pubDate 는 sitemap-blog.xml 의 lastmod 를 참조한다(있을 때). 없으면 생략.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://sekkomi.com';
const MAX_ITEMS = 30;

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseItemList(html) {
  const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  for (const b of blocks) {
    const inner = b
      .replace(/<script type="application\/ld\+json">/, '')
      .replace(/<\/script>/, '');
    try {
      const data = JSON.parse(inner.trim());
      if (data && data['@type'] === 'ItemList' && Array.isArray(data.itemListElement)) {
        return data.itemListElement;
      }
    } catch (e) { /* 다음 블록 시도 */ }
  }
  return null;
}

// slug -> lastmod (YYYY-MM-DD)
function readLastmods() {
  const map = {};
  try {
    const xml = fs.readFileSync(path.join(ROOT, 'public', 'sitemap-blog.xml'), 'utf8');
    const re = /<loc>https:\/\/sekkomi\.com\/blog\/([a-z0-9-]+)<\/loc>\s*<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/g;
    let m;
    while ((m = re.exec(xml)) !== null) map[m[1]] = m[2];
  } catch (e) { /* 없으면 pubDate 생략 */ }
  return map;
}

// 글 HTML 의 meta description 을 요약으로 쓴다 (없으면 제목)
function readDescription(slug) {
  try {
    const f = path.join(ROOT, 'public', 'blog', slug + '.html');
    const html = fs.readFileSync(f, 'utf8');
    const m = html.match(/<meta name="description" content="([^"]*)"/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

function rfc822(ymd) {
  try {
    const d = new Date(ymd + 'T09:00:00+09:00');
    if (isNaN(d.getTime())) return null;
    return d.toUTCString();
  } catch (e) { return null; }
}

function main() {
  try {
    const indexFile = path.join(ROOT, 'public', 'blog', 'index.html');
    const outFile = path.join(ROOT, 'public', 'rss.xml');
    const html = fs.readFileSync(indexFile, 'utf8');

    const items = parseItemList(html);
    if (!items || !items.length) {
      console.log('[build-rss] ItemList 파싱 실패 — 변경 없이 종료');
      return;
    }

    const lastmods = readLastmods();

    // ItemList 는 오래된 글부터 쌓인다 → 최신순으로 뒤집고 상한을 둔다
    const ordered = items.slice().reverse().slice(0, MAX_ITEMS);

    const out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">');
    out.push('  <channel>');
    out.push('    <title>세꼼이 — 부동산 세금 해설</title>');
    out.push('    <link>' + SITE + '/blog/</link>');
    out.push('    <description>양도소득세·종합부동산세·상속증여세를 현행 세법 기준으로 계산까지 풀어 쓰는 블로그. 무료 양도세 계산기 세꼼이(sekkomi.com)가 만듭니다.</description>');
    out.push('    <language>ko</language>');
    out.push('    <atom:link href="' + SITE + '/rss.xml" rel="self" type="application/rss+xml" />');
    const newest = ordered.map(it => {
      const s = (it.url || '').split('/blog/')[1];
      return lastmods[s];
    }).filter(Boolean).sort().pop();
    const built = rfc822(newest) || new Date().toUTCString();
    out.push('    <lastBuildDate>' + built + '</lastBuildDate>');

    for (const it of ordered) {
      if (!it || !it.url || !it.name) continue;
      const slug = it.url.split('/blog/')[1];
      if (!slug) continue;
      const desc = readDescription(slug) || it.name;
      out.push('    <item>');
      out.push('      <title>' + esc(it.name) + '</title>');
      out.push('      <link>' + esc(it.url) + '</link>');
      out.push('      <guid isPermaLink="true">' + esc(it.url) + '</guid>');
      out.push('      <description>' + esc(desc) + '</description>');
      const pd = rfc822(lastmods[slug]);
      if (pd) out.push('      <pubDate>' + pd + '</pubDate>');
      out.push('    </item>');
    }

    out.push('  </channel>');
    out.push('</rss>');
    out.push('');

    fs.writeFileSync(outFile, out.join('\n'), 'utf8');
    console.log('[build-rss] rss.xml 생성 완료 — ' + ordered.length + '편 (전체 ' + items.length + '편 중 최신순)');
  } catch (e) {
    console.log('[build-rss] 오류 — 변경 없이 종료: ' + (e && e.message));
  }
}

main();
