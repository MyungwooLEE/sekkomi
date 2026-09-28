/**
 * build-ads.cjs - Google AdSense on the calculator (public/index.html only).
 *
 * Added 2026-09-28 on owner decision (monetize at the result step).
 * Build output only; _parts/ sources stay untouched (Korean-file transcription
 * risk via MCP, see _parts/README.md). All Korean UI text is \u-escaped so this
 * file stays ASCII-only.
 *
 * What it does:
 *  1. <head>: google-adsense-account meta (site verification) + a loader that
 *     adds adsbygoogle.js ONLY when the URL carries no result deep link (?r= / #r=).
 *     Deep links encode the user's inputs (address, e-mail); ad requests carry the
 *     page URL, so those pages never load ads (no PII to the ad network).
 *  2. runLoading(): "renderS05();show('s05');" -> results are prepared, then a
 *     "result" LINK to /?view=result is shown. A real same-site navigation is what
 *     lets AdSense vignette (full-screen, may be video) appear between the pages.
 *     State travels in sessionStorage, never in the URL.
 *  3. /?view=result restores from sessionStorage and renders the result screen.
 *     Missing/broken state -> falls back to the landing page.
 *  4. Appends an ads/cookie clause to the privacy policy (LEGAL.privacy).
 *
 * Measurement note: calc_complete still fires when the calculation finishes
 * (before the click). Result screens actually opened = page_view with
 * page_location containing view=result (result_view dataLayer event also pushed,
 * but GTM has no tag for it as of 2026-09-28).
 *
 * Idempotent (marker id="sek-ads"). Never fails the build. Invoked at the end of
 * build-noindex.cjs so that netlify.toml (Korean-heavy) need not be re-uploaded.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PUB = 'ca-pub-2936478425920310';
const FILE = path.join(process.cwd(), 'public', 'index.html');
const ANCHOR = "renderS05();show('s05');";
const REPL = "renderS05();(window.sekAdGate?sekAdGate():show('s05'));";

function log(m) { console.log('[build-ads] ' + m); }

const HEAD = '<meta name="google-adsense-account" content="' + PUB + '">\n' +
  '<script id="sek-ads-loader">(function(){try{var s=location.search||"",h=location.hash||"";' +
  'if(/[?&]r=/.test(s)||/[#&]r=/.test(h))return;' +
  'var e=document.createElement("script");e.async=true;' +
  'e.src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + PUB + '";' +
  'e.crossOrigin="anonymous";document.head.appendChild(e);}catch(_){}})();</script>\n';

const BODY = '<style>.sek-go{margin:18px 0 6px;text-align:center}.sek-go .sek-go-h{font-size:15px;font-weight:800;margin-bottom:10px}.sek-go a{text-decoration:none}</style>\n' +
  '<script id="sek-ads">(function(){\n' +
  'var KEY="sek_res_v1";\n' +
  'window.sekAdGate=function(){\n' +
  ' try{sessionStorage.setItem(KEY,JSON.stringify({enc:encodeState(),at:Date.now(),paid:(typeof PAID!=="undefined"&&PAID)}));}catch(e){show("s05");return;}\n' +
  ' var sc=document.getElementById("loadScroll");if(!sc){show("s05");return;}\n' +
  ' if(document.getElementById("sekGo"))return;\n' +
  ' var d=document.createElement("div");d.className="sek-go";\n' +
  ' d.innerHTML=\'<div class="sek-go-h">\uacb0\uacfc\uac00 \uc900\ube44\ub410\uc5b4\uc694</div><a class="btn-main" id="sekGo" href="/?view=result">\uacb0\uacfc \ubcf4\uae30 \u2192</a>\';\n' +
  ' sc.appendChild(d);sc.scrollTop=sc.scrollHeight;\n' +
  '};\n' +
  'function home(){try{history.replaceState(null,"","/");}catch(_){}}\n' +
  'function boot(){try{\n' +
  ' var p=new URLSearchParams(location.search);if(p.get("view")!=="result")return;\n' +
  ' var raw=sessionStorage.getItem(KEY),o=raw?JSON.parse(raw):null;\n' +
  ' if(!o||!o.enc||!restoreState(o.enc)){home();return;}\n' +
  ' A._calcLogged=true;A._resultMailed=true;if(o.paid)PAID=true;\n' +
  ' A.R=calc();renderS05();show("s05");\n' +
  ' try{track("result_view",{});}catch(_){}\n' +
  '}catch(e){home();}}\n' +
  'if(document.readyState==="complete")boot();else window.addEventListener("load",boot);\n' +
  'try{if(typeof LEGAL!=="undefined"&&LEGAL.privacy)LEGAL.privacy[1]+=\'<h4>\uad11\uace0 \uac8c\uc7ac \ubc0f \ucfe0\ud0a4</h4><p>\uc11c\ube44\uc2a4\ub294 Google AdSense\ub97c \ud1b5\ud574 \uad11\uace0\ub97c \uac8c\uc7ac\ud569\ub2c8\ub2e4. Google \ub4f1 \uc81c3\uc790 \uad11\uace0 \uc0ac\uc5c5\uc790\ub294 \ucfe0\ud0a4\ub97c \uc0ac\uc6a9\ud574 \uc774\uc6a9\uc790\uc758 \uc774\uc804 \ubc29\ubb38 \uae30\ub85d\uc744 \ubc14\ud0d5\uc73c\ub85c \uad11\uace0\ub97c \uc81c\uacf5\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4. \uc774\uc6a9\uc790\ub294 Google \uad11\uace0 \uc124\uc815(https://adssettings.google.com)\uc5d0\uc11c \ub9de\ucda4 \uad11\uace0\ub97c \ud574\uc81c\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4. \uc11c\ube44\uc2a4\ub294 \uc785\ub825\ud558\uc2e0 \uc774\uba54\uc77c\u00b7\uc8fc\uc18c \ub4f1 \uac1c\uc778\uc815\ubcf4\ub97c \uad11\uace0 \uc0ac\uc5c5\uc790\uc5d0\uac8c \uc81c\uacf5\ud558\uc9c0 \uc54a\uc73c\uba70, \uacc4\uc0b0 \uacb0\uacfc\uac00 \ub2f4\uae34 \ub9c1\ud06c(\uba54\uc77c\ub85c \ubcf4\ub0b4\ub4dc\ub9ac\ub294 \uacb0\uacfc \ub9c1\ud06c)\ub85c \uc811\uc18d\ud55c \ud654\uba74\uc5d0\ub294 \uad11\uace0\ub97c \ubd88\ub7ec\uc624\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.</p>\';}catch(_){}\n' +
  '})();</script>\n';

function main() {
  try {
    if (!fs.existsSync(FILE)) { log('no public/index.html - skip'); return; }
    let html = fs.readFileSync(FILE, 'utf8');
    if (html.indexOf('id="sek-ads"') !== -1) { log('already applied - skip'); return; }
    const n = html.split(ANCHOR).length - 1;
    if (n !== 1) { log('anchor count ' + n + ' (expected 1) - skip, no change'); return; }
    if (html.indexOf('</head>') === -1 || html.lastIndexOf('</body>') === -1) { log('head/body not found - skip'); return; }
    html = html.replace(ANCHOR, REPL);
    html = html.replace('</head>', HEAD + '</head>');
    const i = html.lastIndexOf('</body>');
    html = html.slice(0, i) + BODY + html.slice(i);
    fs.writeFileSync(FILE, html);
    log('applied (' + PUB + ')');
  } catch (e) {
    log('error (ignored): ' + (e && e.message));
  }
}

main();
