#!/usr/bin/env python3
"""커버(카드1) 훅 줄바꿈 검사기 — 큐 커밋 전에 반드시 돌린다.

왜 필요한가 (2026-08-25 실측):
  .hook-line 은 112px, .content 패딩이 좌우 96px 이라 가용폭이 정확히 888px 다.
  이걸 넘으면 줄바꿈이 나는데, 특히 형광펜 구절(.em)이 줄바꿈되면
  .em .hlbar 가 position:absolute 로 .em 박스 전체를 덮기 때문에
  두 줄이 하나의 라임 사각형으로 칠해지고 글자가 그 위에 겹쳐 읽을 수 없게 된다.
  실제로 2026-08-18·08-19 커버가 이 상태로 인스타에 게시됐다.

사용:
  python3 check_cover.py                    # queue/ 전부
  python3 check_cover.py queue/<id>.html    # 특정 파일
종료코드 0=통과, 1=FAIL 있음
"""
import asyncio, http.server, socketserver, threading, os, sys, glob, shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 8799
AVAIL = 888          # 가용폭 (1080 - 96*2). 템플릿이 바뀌면 런타임 실측값으로 대체된다
NEAR  = 40           # 여유가 이보다 적으면 경고 (폰트 버전 하나에 깨질 수 있다)

os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', '/opt/pw-browsers')
os.environ.setdefault('PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD', '1')

MEASURE = """() => {
  const c = document.querySelector('#c1 .content');
  const cs = getComputedStyle(c);
  const avail = Math.round(c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  const lines = [...document.querySelectorAll('#c1 .hook-line')].map(el => {
    const bb = el.getBoundingClientRect();
    const one = Math.round(bb.height);
    const old = el.style.whiteSpace;
    el.style.whiteSpace = 'nowrap';
    const rg = document.createRange(); rg.selectNodeContents(el);
    const intrinsic = Math.round(rg.getBoundingClientRect().width);
    el.style.whiteSpace = old;
    // 줄바꿈 판정은 line-height 기준으로 한다.
    // 다른 줄과 비교하면 4줄이 전부 줄바꿈된 경우(2026-08-18이 3/4줄이었다)
    // 기준선 자체가 오염돼 아무것도 못 잡는다.
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    return {
      text: el.textContent.trim(),
      intrinsic,
      isEm: !!el.querySelector('.em'),
      offscreen: bb.top < -1 || bb.bottom > 1921,
      renderH: one,
      lineHeight: Math.round(lh),
      wrapped: one > lh * 1.5,
    };
  });
  return { avail, lines };
}"""


async def run(files):
    class H(http.server.SimpleHTTPRequestHandler):
        def translate_path(self, path):
            return os.path.join(ROOT, path.lstrip('/').split('?')[0])
        def log_message(self, *a): pass
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("127.0.0.1", PORT), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    from playwright.async_api import async_playwright
    os.makedirs(os.path.join(ROOT, 'cover_check'), exist_ok=True)
    failures, warnings, tmps = [], [], []

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for n, f in enumerate(files):
            base = os.path.splitext(os.path.basename(f))[0]
            # README 함정: page.goto 가 파일명만 쓰므로 큐 HTML 은 루트로 복사해야
            # ./fonts, ./gsap.min.js 가 해석된다. URL 은 파일마다 달라야 캐시 오염이 없다.
            tmp = '_chk%02d_.html' % n
            shutil.copy(f, os.path.join(ROOT, tmp)); tmps.append(tmp)
            page = await browser.new_page(viewport={'width': 1080, 'height': 1920})
            try:
                await page.goto('http://127.0.0.1:%d/%s' % (PORT, tmp))
                await page.wait_for_function("window.__ready===true", timeout=30000)
                if not await page.evaluate("document.fonts.check('800 112px PretendardLocal')"):
                    failures.append((base, 'Pretendard 미로드 — npm i 후 fonts/ 복원 필요'))
                    await page.close(); continue
                await page.evaluate("window.frameAt(3.6)")
                await page.wait_for_timeout(120)
                r = await page.evaluate(MEASURE)
                await page.screenshot(path=os.path.join(ROOT, 'cover_check', base + '.png'))
            except Exception as e:
                failures.append((base, '렌더 실패: %s' % str(e)[:120]))
                await page.close(); continue
            await page.close()

            avail = r['avail']
            print('\n%s  (가용폭 %dpx)' % (base, avail))
            for l in r['lines']:
                slack = avail - l['intrinsic']
                tag = '[EM]' if l['isEm'] else '    '
                mark = ''
                if l['offscreen']:
                    mark = '  ★FAIL 화면 밖'
                    failures.append((base, '화면 밖으로 나감: %s' % l['text']))
                elif l['wrapped'] and l['isEm']:
                    mark = '  ★FAIL 형광펜 줄 줄바꿈 — 바가 두 줄을 덮어 글자를 가린다'
                    failures.append((base, '형광펜(.em) 줄 줄바꿈: %s (%dpx > %dpx)'
                                     % (l['text'], l['intrinsic'], avail)))
                elif l['wrapped']:
                    mark = '  ▲WARN 줄바꿈 — 고아 글자'
                    warnings.append((base, '줄바꿈: %s (%dpx > %dpx)' % (l['text'], l['intrinsic'], avail)))
                elif slack < NEAR:
                    mark = '  ▲WARN 여유 %dpx' % slack
                    warnings.append((base, '여유 %dpx: %s' % (slack, l['text'])))
                print('   %s %4dpx (여유 %4dpx) %s%s' % (tag, l['intrinsic'], slack, l['text'], mark))

        await browser.close()
    srv.shutdown()
    for t in tmps:
        p_ = os.path.join(ROOT, t)
        if os.path.exists(p_): os.remove(p_)

    print('\n' + '=' * 60)
    if failures:
        print('FAIL %d건' % len(failures))
        for b, m in failures: print('  ✗ [%s] %s' % (b, m))
    if warnings:
        print('WARN %d건' % len(warnings))
        for b, m in warnings: print('  ! [%s] %s' % (b, m))
    if not failures and not warnings:
        print('전부 통과')
    print('커버 PNG: tools/shortform/cover_check/')
    return 1 if failures else 0


if __name__ == '__main__':
    args = sys.argv[1:]
    files = [os.path.abspath(a) for a in args] if args else sorted(glob.glob(os.path.join(ROOT, 'queue', '*.html')))
    if not files:
        print('검사할 큐 파일이 없다'); sys.exit(0)
    sys.exit(asyncio.run(run(files)))
