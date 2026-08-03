#!/usr/bin/env python3
"""
세꼼이 숏폼 렌더러 — Playwright 프레임 캡처 + ffmpeg 인코딩.

  python3 render.py                                  # 기본 템플릿 -> sekkomi_reel.mp4
  python3 render.py --html my.html --out my.mp4      # 다른 HTML / 출력 파일

전제:
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
  (스크립트가 없으면 자동으로 설정한다. `playwright install` 은 절대 실행하지 않는다.)
  fonts/ 와 gsap.min.js 는 레포에 없다 — `npm i` 후 이 스크립트가 node_modules 에서
  자동 복원한다(gsap 은 sha256 검증). 자세한 셋업은 README.md 참고.
경로는 전부 이 디렉터리 기준 상대경로 — 폴더째 옮겨도 그대로 동작한다.
"""
import argparse, hashlib, http.server, os, shutil, socketserver, subprocess, sys, threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
os.environ.setdefault("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", "1")

from playwright.sync_api import sync_playwright  # noqa: E402

W, H, FPS, DUR = 1080, 1920, 30, 19.0
PORT = 8765

# 템플릿 @font-face 가 ./fonts/ 상대경로로 참조하는 5개 weight (500/600/700/800/900)
FONTS = ["Pretendard-Medium.otf", "Pretendard-SemiBold.otf", "Pretendard-Bold.otf",
         "Pretendard-ExtraBold.otf", "Pretendard-Black.otf"]

# gsap@3.15.0 dist/gsap.min.js 의 sha256 (레포 커밋본과 npm 산출물이 바이트 동일함을 확인)
GSAP_SHA256 = "92bb9a96476f983d212a2bc4f54c889039c1696dd4461d40a736860938570fbb"


def serve(root: Path, port: int):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(root), **kw)

        def log_message(self, *a):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def ensure_fonts():
    """fonts/ 는 커밋하지 않는다 (7.6MB). npm 의 pretendard 패키지에서 복원한다.

    이미 있으면 그대로 쓰고, 없으면 node_modules 에서 자동 복사한다.
    둘 다 없으면 무인 실행이 조용히 폴백 폰트로 렌더되는 걸 막기 위해 즉시 실패시킨다.
    """
    dst = HERE / "fonts"
    src = HERE / "node_modules" / "pretendard" / "dist" / "public" / "static"
    missing = [f for f in FONTS if not (dst / f).exists()]
    if not missing:
        return
    if all((src / f).exists() for f in missing):
        dst.mkdir(parents=True, exist_ok=True)
        for f in missing:
            shutil.copy2(src / f, dst / f)
        print(f"fonts/: restored {len(missing)} Pretendard OTF(s) from node_modules/pretendard")
        return
    sys.exit(
        "FATAL: Pretendard OTFs missing: " + ", ".join(missing) + f"\n  expected in: {dst}\n"
        "  fix (from this directory):\n"
        "    npm i\n"
        "    mkdir -p fonts\n"
        "    cp node_modules/pretendard/dist/public/static/"
        "Pretendard-{Medium,SemiBold,Bold,ExtraBold,Black}.otf fonts/"
    )


def ensure_gsap():
    """gsap.min.js 복원 + sha256 무결성 검사.

    gsap.min.js 는 레포에 커밋하지 않는다 (73KB 압축본). fonts/ 와 같은 방식으로
    node_modules/gsap/dist 에서 복원한다 — package-lock.json 이 gsap@3.15.0 을
    integrity 해시까지 핀하므로 npm 사본은 항상 바이트 동일하다.
    깨진 GSAP 은 렌더를 조용히 망가뜨리므로 복원이 불가능하면 즉시 실패시킨다.
    """
    dst = HERE / "gsap.min.js"
    src = HERE / "node_modules" / "gsap" / "dist" / "gsap.min.js"

    def sha(p):
        return hashlib.sha256(p.read_bytes()).hexdigest()

    if dst.exists() and sha(dst) == GSAP_SHA256:
        return
    if src.exists() and sha(src) == GSAP_SHA256:
        shutil.copy2(src, dst)
        print("gsap.min.js: restored from node_modules/gsap (sha256 verified)")
        return
    sys.exit(
        f"FATAL: gsap.min.js missing or corrupt at {dst}\n"
        f"  expected sha256: {GSAP_SHA256}\n"
        f"  found:           {sha(dst) if dst.exists() else '<missing>'}\n"
        "  fix (from this directory):\n"
        "    npm i && cp node_modules/gsap/dist/gsap.min.js ."
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--html", default="sekkomi_shortform_template.html")
    ap.add_argument("--out", default="sekkomi_reel.mp4")
    ap.add_argument("--frames", default="frames")
    args = ap.parse_args()

    html = HERE / args.html
    assert html.exists(), f"HTML not found: {html}"
    ensure_gsap()
    ensure_fonts()

    frames = HERE / args.frames
    if frames.exists():
        shutil.rmtree(frames)
    frames.mkdir(parents=True)

    n = round(DUR * FPS)
    httpd = serve(HERE, PORT)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--force-color-profile=srgb",
                                              "--disable-lcd-text",
                                              "--font-render-hinting=none"])
            page = browser.new_page(viewport={"width": W, "height": H},
                                    device_scale_factor=1)
            errs = []
            page.on("pageerror", lambda e: errs.append(str(e)))
            page.goto(f"http://127.0.0.1:{PORT}/{html.name}", wait_until="load")
            page.wait_for_function("() => window.__ready === true && !!window.tl", timeout=15000)
            page.evaluate("document.fonts.ready")
            page.wait_for_timeout(600)
            if errs:
                raise RuntimeError("page errors: " + "; ".join(errs))

            dur = page.evaluate("window.tl.duration()")
            print(f"timeline duration = {dur}s, capturing {n} frames")

            for i in range(n):
                page.evaluate("t => window.frameAt(t)", i / FPS)
                page.evaluate("() => new Promise(r => requestAnimationFrame(() => r()))")
                page.screenshot(path=str(frames / f"{i:05d}.png"))
                if i % 60 == 0:
                    print(f"  frame {i}/{n}", flush=True)
            browser.close()
    finally:
        httpd.shutdown()

    out = HERE / args.out
    cmd = ["/usr/bin/ffmpeg", "-y", "-r", str(FPS), "-i", str(frames / "%05d.png"),
           "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
           "-movflags", "+faststart", "-r", str(FPS), str(out)]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("wrote", out, out.stat().st_size, "bytes")


if __name__ == "__main__":
    sys.exit(main())
