#!/usr/bin/env node
/**
 * build-landing.cjs - inject landing below-the-fold sections + blog calculator banner
 * (2026-08-13)
 *
 * WHY BUILD-TIME INJECTION
 *   The app body is committed as _parts/index.html.part01..06 chunks. part02, which holds
 *   the landing markup, is over 40KB and mostly Korean text; re-uploading it whole through
 *   an automation tool risks transcription corruption (see 2026-08-11 incident).
 *   So the body chunks are never touched. Instead this script injects the sections into
 *   the already-assembled public/index.html. Same pattern build-blog-featured.cjs uses.
 *
 * TARGETS
 *   1) public/index.html      <- _parts/landing-below.html  (indexable + conversion sections)
 *                              + _parts/landing-desktop.html (desktop refinement, appended)
 *   2) public/blog/index.html <- _parts/blog-banner.html    (calculator CTA above the tabs)
 *
 * SAFETY
 *   - idempotent: skips when the marker class is already present
 *   - anchor miss => log and return, never throw (netlify.toml also wraps with || true)
 *   - source files (_parts/index.html.part*, blog article pages) are never modified
 *
 * NOTE ON THE FOOTER MOVE
 *   The existing .lp-foot sits inside the dark hero. Appending sections after it would
 *   strand the legal links mid-page, so the footer block is removed here and re-created
 *   at the end of _parts/landing-below.html. Keep the two in sync when editing either.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'public', 'index.html');
const BLOG = path.join(ROOT, 'public', 'blog', 'index.html');
const BLOCK = path.join(ROOT, '_parts', 'landing-below.html');
const BANNER = path.join(ROOT, '_parts', 'blog-banner.html');
const DESKTOP = path.join(ROOT, '_parts', 'landing-desktop.html');

/* Matches the .lp-foot block plus the three closing tags of .lp / .scroll / #s01.
   Indentation makes the tail unambiguous, so no Korean literal is needed here. */
const FOOT_RE = /[ ]{4}<div class="lp-foot">[\s\S]*?\n[ ]{4}<\/div>\n[ ]{3}<\/div>\n[ ]{2}<\/div>\n<\/div>/;

function injectLanding() {
  if (!fs.existsSync(INDEX) || !fs.existsSync(BLOCK)) {
    console.log('[landing] index.html or landing-below.html missing - skip');
    return;
  }
  let html = fs.readFileSync(INDEX, 'utf8');
  if (html.indexOf('class="lx-wrap"') !== -1) {
    console.log('[landing] sections already present - skip');
    return;
  }
  if (!FOOT_RE.test(html)) {
    console.log('[landing] .lp-foot anchor not found - skip');
    return;
  }
  let block = fs.readFileSync(BLOCK, 'utf8');
  // Desktop refinement layer. Loaded after the base block so its media queries win.
  // Kept as a separate file because CSS is near-pure ASCII, which survives tooling
  // round-trips far better than the Korean-heavy base block.
  if (fs.existsSync(DESKTOP)) {
    block += '\n' + fs.readFileSync(DESKTOP, 'utf8');
  }
  html = html.replace(FOOT_RE, '   </div>\n' + block + '\n  </div>\n</div>');
  html = applyLightHeroSwaps(html);
  fs.writeFileSync(INDEX, html);
  console.log('[landing] sections injected (+' + Buffer.byteLength(block) + ' bytes)');
}

/* 2026-10-22 light (time.fyi-style) landing.
   The hero moved from dark green to white, which the CSS layer alone cannot finish:
   - the hero logo is the light-on-dark asset -> swap to the dark-on-light one
   - theme-color paints the mobile browser bar dark green -> white
   - Pretendard: the static CSS pulls whole-font files per weight (no unicode-range);
     the variable dynamic-subset CSS downloads only the glyph slices a page uses.
     Family name becomes 'Pretendard Variable' (font stacks in landing-desktop.html
     list it first and keep 'Pretendard' as fallback).
   Runs only after the sections were injected, so a skipped injection leaves the page
   exactly as before. Every swap is exact-match ASCII and requires exactly one hit. */
const SWAPS = [
  ['logo', '<div class="lp-brand"><img src="/logo_full_dark.png"', '<div class="lp-brand"><img src="/logo_full.png"'],
  ['theme-color', '<meta name="theme-color" content="#163300">', '<meta name="theme-color" content="#FFFFFF">'],
  ['font', 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css',
           'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css'],
];

function applyLightHeroSwaps(html) {
  for (const [name, from, to] of SWAPS) {
    const n = html.split(from).length - 1;
    if (n !== 1) {
      console.log('[landing] swap ' + name + ': matched ' + n + ' times (want 1) - skip');
      continue;
    }
    html = html.replace(from, to);
    console.log('[landing] swap ' + name + ': ok');
  }
  return html;
}

const BLOG_ANCHOR = '</div>\n\n<div class="tabs"><div class="tabs-in">';

function injectBlogBanner() {
  if (!fs.existsSync(BLOG) || !fs.existsSync(BANNER)) {
    console.log('[landing] blog/index.html or blog-banner.html missing - skip');
    return;
  }
  let html = fs.readFileSync(BLOG, 'utf8');
  if (html.indexOf('class="lxb-in"') !== -1) {
    console.log('[landing] blog banner already present - skip');
    return;
  }
  const n = html.split(BLOG_ANCHOR).length - 1;
  if (n !== 1) {
    console.log('[landing] blog anchor matched ' + n + ' times (want 1) - skip');
    return;
  }
  const banner = fs.readFileSync(BANNER, 'utf8');
  const replacement = '</div>\n\n' + banner + '\n<div class="tabs"><div class="tabs-in">';
  fs.writeFileSync(BLOG, html.replace(BLOG_ANCHOR, replacement));
  console.log('[landing] blog banner injected');
}

try { injectLanding(); } catch (e) { console.log('[landing] landing inject failed:', e.message); }
try { injectBlogBanner(); } catch (e) { console.log('[landing] banner inject failed:', e.message); }
