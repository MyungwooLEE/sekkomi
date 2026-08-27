/**
 * build-noindex.cjs - inject <meta name="robots" content="noindex,follow">
 * into the blog pages listed in scripts/noindex-slugs.json.
 *
 * Why this way (2026-08-27): editing 16 Korean-heavy HTML files through the
 * GitHub MCP is error-prone (character transcription), so the source files
 * stay untouched and the directive is applied to the build output only.
 * Removing a slug from the JSON list re-enables indexing on the next build.
 *
 * Idempotent. Runs after build-seo-meta.cjs (which adds a max-image-preview
 * robots meta) so that this script can replace that tag's content.
 * Wrapped in try/catch; never fails the build ("|| true" in netlify.toml).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const BLOG = path.join(process.cwd(), 'public', 'blog');
const LIST = path.join(process.cwd(), 'scripts', 'noindex-slugs.json');
const TAG = '<meta name="robots" content="noindex,follow">';

function log(m) { console.log('[build-noindex] ' + m); }

function main() {
  try {
    if (!fs.existsSync(LIST)) { log('no list file - skip'); return; }
    const slugs = JSON.parse(fs.readFileSync(LIST, 'utf8')).slugs || [];
    let done = 0, already = 0, missing = 0;
    for (const slug of slugs) {
      const file = path.join(BLOG, slug + '.html');
      if (!fs.existsSync(file)) { missing++; continue; }
      let html = fs.readFileSync(file, 'utf8');
      if (/<meta name="robots" content="noindex[^"]*">/.test(html)) { already++; continue; }
      if (/<meta name="robots"[^>]*>/.test(html)) {
        html = html.replace(/<meta name="robots"[^>]*>/, TAG);
      } else if (/<link rel="canonical"[^>]*>/.test(html)) {
        html = html.replace(/<link rel="canonical"[^>]*>/, function (m) { return m + '\n' + TAG; });
      } else if (/<\/head>/.test(html)) {
        html = html.replace(/<\/head>/, TAG + '\n</head>');
      } else { missing++; continue; }
      fs.writeFileSync(file, html);
      done++;
    }
    log('noindex applied ' + done + ', already ' + already + ', not found ' + missing + ' (list ' + slugs.length + ')');
  } catch (e) {
    log('error (ignored): ' + (e && e.message));
  }
}

main();
