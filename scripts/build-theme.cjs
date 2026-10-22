#!/usr/bin/env node
/**
 * build-theme.cjs - apply the 2026-10-22 visual standard to every blog page.
 *
 * For each public/blog/*.html (build output only; committed sources untouched):
 *   1) link /theme/blog.css right before </head>, after the page's inline <style>,
 *      so equal-specificity rules in the theme win
 *   2) Pretendard static CSS -> variable dynamic-subset CSS (same swap as the homepage)
 *   3) footer logo: light-on-dark asset -> dark-on-light asset (footer is white now)
 *
 * Why build-time: 66 Korean-heavy article files. Re-uploading them through the
 * automation tooling risks transcription damage (2026-08-11 incident), and git
 * diffs under public/blog drive IndexNow pings (indexnow-notify.cjs) - a pure style
 * change must not ping 66 URLs. Injecting here changes neither.
 *
 * Safety: idempotent (skips pages already linking the theme), every swap is exact
 * ASCII and requires exactly one hit per page, never throws (netlify.toml wraps
 * with || true as well).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const BLOG = path.join(__dirname, '..', 'public', 'blog');
const THEME_HREF = '/theme/blog.css?v=20261022';
const LINK = '<link rel="stylesheet" href="' + THEME_HREF + '">\n';
const FONT_FROM = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css';
const FONT_TO = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css';
const FT_LOGO_RE = /(<img src=")assets\/logo_full_dark\.png("[^>]*class="ft-logo")/g;

function count(s, sub) { return s.split(sub).length - 1; }

function run() {
  if (!fs.existsSync(BLOG)) { console.log('[theme] public/blog missing - skip'); return; }
  const files = fs.readdirSync(BLOG).filter((f) => f.endsWith('.html'));
  const stat = { linked: 0, already: 0, skipped: 0, font: 0, logo: 0 };
  for (const f of files) {
    const p = path.join(BLOG, f);
    let html;
    try { html = fs.readFileSync(p, 'utf8'); } catch (e) { stat.skipped++; continue; }
    if (html.indexOf('href="/theme/blog.css') !== -1) { stat.already++; continue; }
    if (count(html, '</head>') !== 1) {
      console.log('[theme] ' + f + ': </head> count != 1 - skip');
      stat.skipped++;
      continue;
    }
    html = html.replace('</head>', LINK + '</head>');
    stat.linked++;
    if (count(html, FONT_FROM) === 1) { html = html.replace(FONT_FROM, FONT_TO); stat.font++; }
    const logos = (html.match(FT_LOGO_RE) || []).length;
    if (logos === 1) { html = html.replace(FT_LOGO_RE, '$1assets/logo_full.png$2'); stat.logo++; }
    fs.writeFileSync(p, html);
  }
  console.log('[theme] pages=' + files.length + ' linked=' + stat.linked + ' already=' + stat.already +
    ' skipped=' + stat.skipped + ' font=' + stat.font + ' footer-logo=' + stat.logo);
}

try { run(); } catch (e) { console.log('[theme] failed:', e.message); }
