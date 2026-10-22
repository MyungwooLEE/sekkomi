#!/usr/bin/env node
/**
 * build-utm.cjs - give every blog CTA a page-unique utm_content label.
 *
 * Problem this fixes (open item "utm_content labels shared across pages"):
 *   CTA links in articles carry position-only labels - utm_content=nav / mid /
 *   mid2 / final / end. 65 pages share "nav", 23 share "mid", 18 share "final".
 *   GA4 therefore cannot attribute a calculator entry to the article it came
 *   from, which blocks every per-page conversion question. Measurement design
 *   is the ceiling on analysis.
 *
 * Fix: at build time rewrite each generic label to "<slug>-<position>", e.g.
 *   /?...&utm_content=mid  ->  /?...&utm_content=billa-dasedae-jutaek-su-mid
 *   Labels that are already page-specific (yangdose-serul-top, officetel-mid1,
 *   series-nav, list-nav) are left untouched.
 *
 * Why build-time, not a content edit: 65 Korean-heavy article files. Rewriting
 * them through the automation tooling risks transcription damage (2026-08-11
 * incident), and git diffs under public/blog drive IndexNow pings
 * (indexnow-notify.cjs) - a tracking-label change must not ping 65 URLs.
 * Injecting here changes neither. Same rationale as build-theme.cjs.
 *
 * Safety: naturally idempotent (the pattern requires a bare position label, so
 * "<slug>-mid" can never match again), exact ASCII match, per-file try/catch,
 * never throws (netlify.toml wraps with || true as well).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const BLOG = path.join(__dirname, '..', 'public', 'blog');
// Bare position labels only. Order matters for neither - the regex alternation
// is anchored on both sides so "mid" cannot swallow "mid2".
const GENERIC = /utm_content=(nav|mid2|mid|final|end)(?=["&])/g;

function run() {
  if (!fs.existsSync(BLOG)) { console.log('[utm] public/blog missing - skip'); return; }
  const files = fs.readdirSync(BLOG).filter((f) => f.endsWith('.html') && f !== 'index.html');
  const stat = { pages: 0, rewritten: 0, labels: 0, clean: 0, skipped: 0 };
  for (const f of files) {
    stat.pages++;
    const p = path.join(BLOG, f);
    const slug = f.slice(0, -5);
    let html;
    try { html = fs.readFileSync(p, 'utf8'); } catch (e) { stat.skipped++; continue; }
    const hits = (html.match(GENERIC) || []).length;
    if (hits === 0) { stat.clean++; continue; }
    const out = html.replace(GENERIC, 'utm_content=' + slug + '-$1');
    // Sanity: byte growth must equal hits * (slug + 1 separator). If it does
    // not, something other than the labels moved - leave the file alone.
    const expected = Buffer.byteLength(html, 'utf8') + hits * (Buffer.byteLength(slug, 'utf8') + 1);
    if (Buffer.byteLength(out, 'utf8') !== expected) {
      console.log('[utm] ' + f + ': unexpected byte delta - skip');
      stat.skipped++;
      continue;
    }
    try { fs.writeFileSync(p, out); } catch (e) { stat.skipped++; continue; }
    stat.rewritten++;
    stat.labels += hits;
  }
  console.log('[utm] pages=' + stat.pages + ' rewritten=' + stat.rewritten +
    ' labels=' + stat.labels + ' already-specific=' + stat.clean + ' skipped=' + stat.skipped);
}

try { run(); } catch (e) { console.log('[utm] failed:', e.message); }
