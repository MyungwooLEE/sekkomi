/**
 * build-ads.cjs - Google AdSense on the calculator (public/index.html only).
 *
 * 2026-09-28 (owner decision, v2 after design review):
 *  - Ad is a fixed-size 320x100 unit pinned at the top of the calculating
 *    screen (#s04), under the "calculating" card, with a one-line explanation
 *    ("ads keep the calculator free"). Results still open automatically.
 *  - v1's "result" button + vignette gate was dropped (felt abrupt, double ad).
 *
 * Build output only; _parts/ sources stay untouched (Korean-file transcription
 * risk via MCP, see _parts/README.md). Korean text is \u-escaped: ASCII-only file.
 *
 * What it injects:
 *  1. <head>: google-adsense-account meta (site verification) + a loader that
 *     adds adsbygoogle.js ONLY when the URL carries no result deep link (?r= / #r=).
 *     Deep links encode user inputs (address, e-mail); ad requests carry the page
 *     URL, so those pages never load ads (no PII to the ad network).
 *  2. #s04: the ad block, ONLY if SLOT_LOADING is set. Ad units can be created only
 *     after AdSense approves the site, so until then SLOT_LOADING is '' and nothing
 *     visible is added. To enable: put the unit's data-ad-slot id below, push.
 *     Block shows only if adsbygoogle.js actually ran (blocked -> stays hidden);
 *     hides itself again if Google reports the slot unfilled.
 *  3. Privacy policy: ads/cookie clause appended to LEGAL.privacy.
 *
 * Idempotent (marker id="sek-ads"). Never fails the build. Invoked at the end of
 * build-noindex.cjs so that netlify.toml (Korean-heavy) need not be re-uploaded.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PUB = 'ca-pub-2936478425920310';
const SLOT_LOADING = ''; // e.g. '1234567890' - set after AdSense approval (320x100 fixed unit)
const FILE = path.join(process.cwd(), 'public', 'index.html');
const A_HOOK = "$('#adFix').innerHTML=loadHeroHtml();";
const A_DIV = '<div id="adFix" style="flex:none;padding:14px 18px 0"></div>';

function log(m) { console.log('[build-ads] ' + m); }

const HEAD = '<meta name="google-adsense-account" content="' + PUB + '">\n' +
  '<script id="sek-ads-loader">(function(){try{var s=location.search||"",h=location.hash||"";' +
  'if(/[?&]r=/.test(s)||/[#&]r=/.test(h))return;' +
  'var e=document.createElement("script");e.async=true;' +
  'e.src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + PUB + '";' +
  'e.crossOrigin="anonymous";document.head.appendChild(e);}catch(_){}})();</script>\n';

const AD_BLOCK = '<div id="adTop" style="flex:none;padding:12px 18px 0;display:none">' +
  '<div style="font-size:12.5px;line-height:1.45;color:#6b7280;margin:0 2px 6px;display:flex;justify-content:space-between;gap:8px">' +
  '<span>\uacc4\uc0b0\ud558\ub294 \ub3d9\uc548 \uc7a0\uae50 \uad11\uace0\uac00 \ub098\uc640\uc694. \uc138\uaf3c\uc774\ub294 \uad11\uace0 \uc218\uc775\uc73c\ub85c <b>\ubb34\ub8cc</b>\ub85c \uc6b4\uc601\ub3fc\uc694</span><span style="flex:none;font-weight:700;color:#9ca3af">\uad11\uace0</span></div>' +
  '<div style="text-align:center;min-height:100px"><ins class="adsbygoogle" style="display:inline-block;width:320px;height:100px"' +
  ' data-ad-client="' + PUB + '" data-ad-slot="' + SLOT_LOADING + '"></ins></div></div>';

const BODY = '<style>#adTop:has(ins.adsbygoogle[data-ad-status="unfilled"]){display:none!important}</style>\n' +
  '<script id="sek-ads">(function(){\n' +
  'var pushed=false;\n' +
  'window.sekAdShow=function(){try{\n' +
  ' var b=document.getElementById("adTop");if(!b)return;\n' +
  ' if(!(window.adsbygoogle&&window.adsbygoogle.loaded))return;\n' +
  ' b.style.display="";\n' +
  ' if(!pushed){pushed=true;(window.adsbygoogle=window.adsbygoogle||[]).push({});}\n' +
  '}catch(_){}};\n' +
  'try{if(typeof LEGAL!=="undefined"&&LEGAL.privacy)LEGAL.privacy[1]+=\'<h4>\uad11\uace0 \uac8c\uc7ac \ubc0f \ucfe0\ud0a4</h4><p>\uc11c\ube44\uc2a4\ub294 Google AdSense\ub97c \ud1b5\ud574 \uad11\uace0\ub97c \uac8c\uc7ac\ud569\ub2c8\ub2e4. Google \ub4f1 \uc81c3\uc790 \uad11\uace0 \uc0ac\uc5c5\uc790\ub294 \ucfe0\ud0a4\ub97c \uc0ac\uc6a9\ud574 \uc774\uc6a9\uc790\uc758 \uc774\uc804 \ubc29\ubb38 \uae30\ub85d\uc744 \ubc14\ud0d5\uc73c\ub85c \uad11\uace0\ub97c \uc81c\uacf5\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4. \uc774\uc6a9\uc790\ub294 Google \uad11\uace0 \uc124\uc815(https://adssettings.google.com)\uc5d0\uc11c \ub9de\ucda4 \uad11\uace0\ub97c \ud574\uc81c\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4. \uc11c\ube44\uc2a4\ub294 \uc785\ub825\ud558\uc2e0 \uc774\uba54\uc77c\u00b7\uc8fc\uc18c \ub4f1 \uac1c\uc778\uc815\ubcf4\ub97c \uad11\uace0 \uc0ac\uc5c5\uc790\uc5d0\uac8c \uc81c\uacf5\ud558\uc9c0 \uc54a\uc73c\uba70, \uacc4\uc0b0 \uacb0\uacfc\uac00 \ub2f4\uae34 \ub9c1\ud06c(\uba54\uc77c\ub85c \ubcf4\ub0b4\ub4dc\ub9ac\ub294 \uacb0\uacfc \ub9c1\ud06c)\ub85c \uc811\uc18d\ud55c \ud654\uba74\uc5d0\ub294 \uad11\uace0\ub97c \ubd88\ub7ec\uc624\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.</p>\';}catch(_){}\n' +
  '})();</script>\n';

function once(html, needle) { return html.split(needle).length - 1 === 1; }

function main() {
  try {
    if (!fs.existsSync(FILE)) { log('no public/index.html - skip'); return; }
    let html = fs.readFileSync(FILE, 'utf8');
    if (html.indexOf('id="sek-ads"') !== -1) { log('already applied - skip'); return; }
    if (html.indexOf('</head>') === -1 || html.lastIndexOf('</body>') === -1) { log('head/body not found - skip'); return; }
    html = html.replace('</head>', HEAD + '</head>');
    if (SLOT_LOADING) {
      if (once(html, A_HOOK) && once(html, A_DIV)) {
        html = html.replace(A_DIV, A_DIV + '\n  ' + AD_BLOCK);
        html = html.replace(A_HOOK, A_HOOK + 'window.sekAdShow&&sekAdShow();');
        log('loading-screen unit ' + SLOT_LOADING);
      } else { log('loading-screen anchors not unique - unit skipped'); }
    } else { log('SLOT_LOADING empty - meta/loader only'); }
    const i = html.lastIndexOf('</body>');
    html = html.slice(0, i) + BODY + html.slice(i);
    fs.writeFileSync(FILE, html);
    log('applied (' + PUB + ')');
  } catch (e) {
    log('error (ignored): ' + (e && e.message));
  }
}

main();
