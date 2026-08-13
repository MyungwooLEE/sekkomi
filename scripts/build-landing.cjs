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
  const block = fs.readFileSync(BLOCK, 'utf8');
  html = html.replace(FOOT_RE, '   </div>\n' + block + '\n  </div>\n</div>');
  fs.writeFileSync(INDEX, html);
  console.log('[landing] sections injected (+' + Buffer.byteLength(block) + ' bytes)');
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
