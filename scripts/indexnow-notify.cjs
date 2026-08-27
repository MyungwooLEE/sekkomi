/**
 * indexnow-notify.cjs - tell Naver (and Bing via api.indexnow.org) which URLs
 * were added or changed in this build, so they get crawled within a day
 * instead of waiting for the sitemap cycle.
 *
 * Why (2026-08-27): Naver Search Advisor indexed 9 pages on 08-12 (sitemap
 * submit) and nothing published after that date. Google last read our
 * sitemaps on 07-18/07-21. Both engines were simply not receiving new URLs.
 * Naver supports IndexNow since 2023-07 (searchadvisor.naver.com/indexnow).
 *
 * Runs at the end of the Netlify build command with "|| true". Never throws.
 *
 * URL selection:
 *   1) git diff CACHED_COMMIT_REF..COMMIT_REF under public/blog, public/index.html,
 *      public/data  -> changed pages only (normal mode)
 *   2) if the diff is unavailable, or today <= SEED_UNTIL (one-time catch-up
 *      window for the ~50 pages the engines never received), submit every
 *      URL listed in sitemap-core.xml + sitemap-blog.xml
 *   3) slugs in scripts/noindex-slugs.json are always skipped
 *
 * Key file: public/<KEY>.txt (must contain exactly the key). keyLocation is
 * sent with every request as IndexNow requires.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const cp = require('child_process');

const HOST = 'sekkomi.com';
const KEY = 'd72450a05e091c0e5ff9d9bc72789b11';
const KEY_LOCATION = 'https://' + HOST + '/' + KEY + '.txt';
const SEED_UNTIL = '2026-08-30'; // inclusive, YYYY-MM-DD (KST)
const ENDPOINTS = [
  'https://searchadvisor.naver.com/indexnow',
  'https://api.indexnow.org/indexnow',
];
const PUB = path.join(process.cwd(), 'public');

function log(m) { console.log('[indexnow] ' + m); }

function todayKST() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function readNoindex() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join('scripts', 'noindex-slugs.json'), 'utf8'));
    return new Set(Array.isArray(j.slugs) ? j.slugs : []);
  } catch (e) { return new Set(); }
}

function sitemapUrls(file) {
  try {
    const s = fs.readFileSync(path.join(PUB, file), 'utf8');
    const out = [];
    const re = /<loc>([^<]+)<\/loc>/g;
    let m;
    while ((m = re.exec(s))) out.push(m[1].trim());
    return out;
  } catch (e) { return []; }
}

function fileToUrl(f) {
  if (f === 'public/index.html') return 'https://' + HOST + '/';
  if (f === 'public/blog/index.html') return 'https://' + HOST + '/blog/';
  if (f === 'public/data/index.html') return 'https://' + HOST + '/data/';
  const m = f.match(/^public\/blog\/([A-Za-z0-9._-]+)\.html$/);
  if (m) return 'https://' + HOST + '/blog/' + m[1];
  return null;
}

function changedUrls() {
  const a = process.env.CACHED_COMMIT_REF;
  const b = process.env.COMMIT_REF;
  if (!a || !b || a === b) { log('no commit range (' + a + '..' + b + ')'); return null; }
  try {
    const out = cp.execSync('git diff --name-only ' + a + ' ' + b + ' -- public/blog public/index.html public/data',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').map(function (s) { return s.trim(); }).filter(Boolean).map(fileToUrl).filter(Boolean);
  } catch (e) { log('git diff unavailable: ' + (e && e.message)); return null; }
}

function slugOf(u) {
  const m = u.match(/\/blog\/([^/?#]+)$/);
  return m ? m[1] : null;
}

function post(endpoint, body) {
  return new Promise(function (resolve) {
    let done = false;
    const finish = function (msg) { if (!done) { done = true; resolve(msg); } };
    try {
      const u = new URL(endpoint);
      const data = JSON.stringify(body);
      const req = https.request({
        hostname: u.hostname, path: u.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) },
        timeout: 10000,
      }, function (res) {
        let chunks = '';
        res.on('data', function (c) { chunks += c; });
        res.on('end', function () { finish(endpoint + ' -> HTTP ' + res.statusCode + (chunks ? ' ' + chunks.slice(0, 120).replace(/\s+/g, ' ') : '')); });
      });
      req.on('timeout', function () { req.destroy(new Error('timeout')); });
      req.on('error', function (e) { finish(endpoint + ' -> error ' + e.message); });
      req.write(data);
      req.end();
    } catch (e) { finish(endpoint + ' -> exception ' + (e && e.message)); }
  });
}

async function main() {
  try {
    const noindex = readNoindex();
    const all = sitemapUrls('sitemap-core.xml').concat(sitemapUrls('sitemap-blog.xml'));
    let urls = changedUrls();
    const seed = todayKST() <= SEED_UNTIL;
    if (urls === null) { log('falling back to full sitemap list'); urls = all.slice(); }
    if (seed) { log('seed window active until ' + SEED_UNTIL + ' - adding full sitemap list'); urls = urls.concat(all); }
    const seen = new Set();
    urls = urls.filter(function (u) {
      if (!u || seen.has(u)) return false;
      seen.add(u);
      const s = slugOf(u);
      return !(s && noindex.has(s));
    });
    if (urls.length === 0) { log('nothing to submit'); return; }
    if (!fs.existsSync(path.join(PUB, KEY + '.txt'))) { log('key file missing in public/ - skip'); return; }
    log('submitting ' + urls.length + ' url(s)');
    const body = { host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList: urls.slice(0, 10000) };
    const results = await Promise.all(ENDPOINTS.map(function (ep) { return post(ep, body); }));
    results.forEach(log);
  } catch (e) {
    log('unexpected error (ignored): ' + (e && e.message));
  }
}

main();
