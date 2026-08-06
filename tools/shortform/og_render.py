#!/usr/bin/env python3
"""og_render.py — 글 전용 OG 카드(1200x630) 생성기

왜 필요한가
-----------
구글 디스커버는 큰 이미지 카드로만 노출되고, 그 후보가 되려면 글마다 1200px 이상의
고유 대표 이미지가 있어야 한다. 세꼼이 블로그는 오랫동안 여러 글이 같은 히어로
이미지를 공유해 왔고, 그 상태로는 디스커버·SNS 공유 어느 쪽에서도 카드가 서지 않는다.

동작
----
릴스 큐(tools/shortform/queue/<id>.html|json)의 훅 문구를 읽어 og_card.html 을
1200x630으로 스크린샷해 public/reels/<id>_og.jpg 로 저장한다.

호출 지점
--------
GitHub Actions 의 렌더 워크플로가 렌더 직후 실행하는 scripts/reel-queue-add.cjs 가
이 스크립트를 부른다. 워크플로는 `git add public/reels` 로 디렉터리를 통째로
커밋하므로, 여기에 파일을 쓰면 워크플로 파일(.github/workflows/)을 고치지 않고도
산출물이 함께 커밋된다. (자동화 토큰에 workflow 스코프가 없어 그 경로는 못 건드린다)

수동 실행:  python3 tools/shortform/og_render.py <id> [<id> ...]

실패해도 절대 상위 파이프라인을 깨지 않는다 — 항상 exit 0.
"""
import http.server
import json
import re
import socketserver
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
QUEUE = HERE / "queue"
OUT_DIR = (HERE / ".." / ".." / "public" / "reels").resolve()
TEMPLATE = "og_card.html"
W, H = 1200, 630
FONTS = ["Pretendard-Medium.otf", "Pretendard-SemiBold.otf", "Pretendard-Bold.otf",
         "Pretendard-ExtraBold.otf", "Pretendard-Black.otf"]


def serve(root: Path):
    """임의 포트로 정적 서버를 띄우고 (httpd, port) 를 돌려준다."""
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(root), **kw)

        def log_message(self, *a):
            pass

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def ensure_fonts():
    """render.py 와 같은 방식으로 node_modules 에서 Pretendard 를 복원한다."""
    import shutil
    dst = HERE / "fonts"
    src = HERE / "node_modules" / "pretendard" / "dist" / "public" / "static"
    missing = [f for f in FONTS if not (dst / f).exists()]
    if not missing:
        return True
    if all((src / f).exists() for f in missing):
        dst.mkdir(parents=True, exist_ok=True)
        for f in missing:
            shutil.copy2(src / f, dst / f)
        return True
    print(f"og: 폰트 없음({', '.join(missing)}) — 생략")
    return False


def headline_for(stem: str):
    """OG 카드 문구를 뽑는다.

    (1) 큐 JSON 의 og_headline  (2) 큐 HTML 카드1(훅) 텍스트 순으로 찾는다.
    둘 다 없으면 None → 호출부가 생성을 건너뛴다.
    """
    meta = {}
    qj = QUEUE / f"{stem}.json"
    if qj.exists():
        try:
            meta = json.loads(qj.read_text(encoding="utf-8")) or {}
        except Exception:
            meta = {}

    headline = str(meta.get("og_headline") or "").strip()
    if not headline:
        qh = QUEUE / f"{stem}.html"
        if qh.exists():
            try:
                raw = qh.read_text(encoding="utf-8")
                block = re.search(r'id="c1".*?</section>', raw, re.S)
                if block:
                    parts = re.findall(r'class="hook-line">(.*?)</div>', block.group(0), re.S)
                    txt = " ".join(re.sub(r"<[^>]+>", "", x) for x in parts)
                    headline = re.sub(r"\s+", " ", txt).strip()
            except Exception:
                headline = ""
    if not headline:
        return None
    return {"headline": headline, "kicker": str(meta.get("og_kicker") or "세꼼이 · 부동산 세금")}


def render_one(stem: str) -> bool:
    from playwright.sync_api import sync_playwright

    if not (HERE / TEMPLATE).exists():
        print(f"og: 템플릿 없음({TEMPLATE}) — 생략")
        return False
    card = headline_for(stem)
    if not card:
        print(f"og: {stem} 문구를 찾지 못함 — 생략")
        return False

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{stem}_og.jpg"
    httpd, port = serve(HERE)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--force-color-profile=srgb",
                                              "--disable-lcd-text",
                                              "--font-render-hinting=none"])
            page = browser.new_page(viewport={"width": W, "height": H},
                                    device_scale_factor=1)
            page.goto(f"http://127.0.0.1:{port}/{TEMPLATE}", wait_until="load")
            page.evaluate("o => window.setCard(o)", card)
            page.wait_for_function("() => window.__ogReady === true", timeout=10000)
            page.evaluate("document.fonts.ready")
            page.wait_for_timeout(400)
            page.screenshot(path=str(out_path), type="jpeg", quality=88)
            browser.close()
    finally:
        httpd.shutdown()
        httpd.server_close()

    print(f"og: wrote {out_path} ({out_path.stat().st_size} bytes)")
    return True


def main():
    ids = [a for a in sys.argv[1:] if a.strip()]
    if not ids:
        print("og: 대상 id 없음")
        return 0
    if not ensure_fonts():
        return 0
    ok = 0
    for stem in ids:
        try:
            if render_one(stem):
                ok += 1
        except Exception as e:
            # OG 카드는 부가 산출물이다. 실패해도 릴스·커밋 파이프라인을 막지 않는다.
            print(f"og: {stem} 생성 실패 — 무시하고 계속: {e}")
    print(f"og: {ok}/{len(ids)}건 생성")
    return 0


if __name__ == "__main__":
    sys.exit(main())
