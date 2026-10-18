#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
블로그 글 HTML 상설 검사기 — 2026-10-19 신설

왜 만들었나.
  조립 스크립트의 assert 는 매 발행·강화 세션이 그때그때 다시 쓰는 일회용이었다.
  그래서 한 세션이 넣은 가드가 다음 세션에 이월되지 않았고, 같은 종류의 결함이
  두 번 나왔다.
    - 2026-10-15 빌라 편: 신설 FAQ 1문항이 기존 3번과 띄어쓰기만 다른 중복이었다.
      (같은 FAQPage 안에 중복 문항 2개 → 다음 커밋 0af4d47 로 정정)
    - description 80자 초과는 scripts/build-seo-meta.cjs 의 맵 주입 조건을
      되살려 강화 문구를 조용히 과거로 되돌린다(운영 규칙 §1.4).
  둘 다 "커밋 전에 기계가 보면 반드시 잡히는" 종류다. 그래서 상설화한다.

위치가 tools/ 인 이유.
  netlify.toml 의 ignore 규칙은 public·netlify·netlify.toml·scripts·_parts·
  package.json 변경시에만 빌드한다. tools/ 는 빌드를 돌리지 않으므로 이 파일을
  추가·수정해도 프로덕션 배포(1회 15크레딧)가 발생하지 않는다.
  빌드 게이트가 아니라 "세션이 커밋 전에 돌리는 검사기"로 설계한 것이다.

사용법.
  python3 tools/audit/check_blog_html.py                     # public/blog 전수
  python3 tools/audit/check_blog_html.py public/blog/x.html  # 특정 파일
  python3 tools/audit/check_blog_html.py --quiet             # FAIL 만 출력
종료 코드: 0 = 전부 통과 / 1 = FAIL 1건 이상. 커밋 금지 신호로 쓴다.

판정 등급.
  FAIL = 커밋하면 안 되는 결함.
  WARN = 사람이 봐야 하는 단서. 정상인 경우가 있어 종료 코드를 올리지 않는다.
"""

import json
import os
import re
import sys
import unicodedata

BLOG_DIR = "public/blog"
# 글이 아닌 파일 — 검사 대상에서 뺀다.
NOT_ARTICLE = {"index.html"}

DESC_LIMIT = 80  # 운영 규칙 §1.4 — 초과하면 blog-descriptions.json 맵이 덮어쓴다
DESC_MAP_FILE = "scripts/blog-descriptions.json"

# build-seo-meta.cjs 가 쓰는 것과 같은 정규식. 이 패턴에 안 걸리면 맵 주입 자체가
# 일어나지 않으므로, 패턴 일치 여부가 곧 '맵이 이 글에 적용되는가'다.
BUILD_DESC_RE = re.compile(r'<meta name="description" content="([^"]*)">')


def load_desc_map():
    try:
        with open(DESC_MAP_FILE, encoding="utf-8") as fh:
            j = json.load(fh)
        return j if isinstance(j, dict) else {}
    except Exception:
        return {}


def decode_entities(s):
    """build-seo-meta.cjs 의 decodeEntities 와 같은 셈법.
    길이 판정이 빌드 스크립트와 어긋나면 검사기가 틀린 쪽이 된다."""
    for a, b in (("&#x27;", "'"), ("&#39;", "'"), ("&quot;", '"'),
                 ("&lt;", "<"), ("&gt;", ">"), ("&amp;", "&")):
        s = s.replace(a, b)
    return s


def norm_question(s):
    """FAQ 문항 비교용 정규화.

    띄어쓰기만 다른 중복을 잡는 것이 목적이므로 공백을 전부 지운다.
    물음표·마침표·가운뎃점 같은 끝맺음 기호도 지운다. 2026-10-15 결함이
    '빌라는 주택 수에 포함되나요?' 대 '빌라는 주택수에 포함되나요?' 였다 —
    공백 하나와 물음표 유무 차이였다.
    NFC 정규화를 먼저 거는 이유는 한글 자모 분리형(NFD)이 섞여 들어오면
    눈으로 같은 글자가 바이트로 달라지기 때문이다.
    """
    s = unicodedata.normalize("NFC", s)
    s = re.sub(r"<[^>]+>", "", s)          # 안쪽 태그 제거
    s = re.sub(r"&[a-zA-Z]+;|&#\d+;", "", s)  # 엔티티 제거
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"[?!.·…：:,、，]+", "", s)
    return s


def head_of(s):
    """<head> 범위. 없으면 <article> 직전까지로 대체한다."""
    m = re.search(r"<head\b[^>]*>(.*?)</head>", s, re.S | re.I)
    if m:
        return m.group(1)
    i = s.find("<article")
    return s[:i] if i > 0 else s


def strip_scripts(s):
    """<script> 블록 제거. GTM 인라인 스크립트의 따옴표가
    content="..." 정규식에 오탐을 만들기 때문이다."""
    return re.sub(r"<script\b[^>]*>.*?</script>", "", s, flags=re.S | re.I)


def jsonld_blocks(s):
    """head 의 JSON-LD 블록을 파싱해 돌려준다. 파싱 실패도 결함이므로 같이 보고."""
    out, bad = [], []
    for m in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        s, re.S | re.I
    ):
        raw = m.group(1).strip()
        try:
            out.append(json.loads(raw))
        except Exception as e:
            bad.append(str(e).split("\n")[0][:90])
    return out, bad


def check_file(path, desc_map=None, strict=False):
    """한 파일을 검사해 (fails, warns) 를 돌려준다."""
    fails, warns = [], []
    desc_map = desc_map if desc_map is not None else {}
    slug0 = os.path.basename(path)[:-5]
    raw = open(path, "rb").read()
    s = raw.decode("utf-8", errors="replace")
    head = head_of(s)
    head_ns = strip_scripts(head)

    # ── 0. 인코딩 ────────────────────────────────────────────────
    # U+FFFD 는 서브에이전트 전사 사고의 흔적이다(운영 규칙 §0-1).
    n_repl = s.count("�")
    if n_repl:
        fails.append("U+FFFD 치환문자 %d건 — 인코딩 훼손" % n_repl)

    # ── 1. 구조 ──────────────────────────────────────────────────
    n_open = len(re.findall(r"<article\b", s))
    n_close = s.count("</article>")
    if n_open != 1 or n_close != 1:
        fails.append("article 태그 개수 이상 — 여는 %d · 닫는 %d (각 1이어야 함)"
                     % (n_open, n_close))

    # ── 2. ⓐ description 80자 초과 범위 검사 ─────────────────────
    # 운영 규칙 §1.4. 단, 맵 주입 조건은 "슬러그가 맵에 있고 AND 80자 초과"
    # 두 가지가 모두 참일 때다. 2026-10-19 최초 구현에서 뒤쪽 조건만 보고
    # 56/64 파일을 FAIL 로 띄웠다 — 검사기 자신이 반쪽 조건으로 돌고 있었다.
    # 그래서 두 경우를 등급으로 가른다.
    #   맵에 없는데 80자 초과 → FAIL. 아무도 고쳐 주지 않아 SERP 에서 잘린다.
    #   맵에 있고 80자 초과   → 맵 주입 활성. 라이브 문구는 맵의 것이고
    #                           HTML 의 문구는 죽은 글자다. 결함이 아니라 상태다.
    in_map = slug0 in desc_map
    bm = BUILD_DESC_RE.search(s)
    dm = re.search(r'<meta\s+name="description"\s+content="([^"]*)"', head_ns)

    if not dm:
        fails.append("meta description 없음")
        cur_len, injected = 0, False
    else:
        cur_len = len(decode_entities(dm.group(1)))
        if in_map and not bm:
            # 맵에 있는데 빌드 정규식에 안 걸린다 = 맵이 조용히 무시된다.
            fails.append("맵에 있으나 빌드 정규식에 불일치 — 맵 주입이 일어나지 않는다")
        injected = bool(in_map and bm and cur_len > DESC_LIMIT)

        if cur_len > DESC_LIMIT and not in_map:
            fails.append("meta description %d자 (80자 초과·맵에 없음) — 보정해 줄 장치가 없다"
                         % cur_len)
        elif injected:
            live = decode_entities(desc_map[slug0])
            msg = ("맵 주입 활성 — 라이브 description 은 맵의 %d자 문구이고 "
                   "HTML 의 %d자는 반영되지 않는다. 이 글을 강화하면 "
                   "HTML description 을 80자 이내로 다시 써야 새 문구가 산다."
                   % (len(live), cur_len))
            (fails if strict else warns).append(msg)

        if '"' in dm.group(1):
            fails.append("meta description 에 큰따옴표 포함")

    # og:title 등 description 이 아닌 content 는 길어도 된다 — 참고로만 남긴다.
    for m in re.finditer(r'content="([^"]*)"', head_ns):
        v = decode_entities(m.group(1))
        if len(v) <= DESC_LIMIT:
            continue
        ctx = head_ns[max(0, m.start() - 120):m.start()]
        nm = re.findall(r'(?:name|property)="([^"]+)"', ctx)
        nm = nm[-1] if nm else "?"
        if nm == "description":
            continue  # 위에서 이미 판정했다
        warns.append("%s %d자 (80자 초과)" % (nm, len(v)))

    # ── 3. description 3곳 일치 ──────────────────────────────────
    # ★ build-seo-meta.cjs 는 meta 만 교체한다. og 와 JSON-LD 는 건드리지 않는다.
    #   따라서 맵 주입이 활성인 글은 빌드 후 meta 와 og 가 반드시 갈라진다.
    #   레포 HTML 세 곳을 맞춰 놓아도 라이브에서는 어긋난다 — 레포만 보고
    #   "일치시켰다"고 보고할 수 없는 구조다. 그래서 주입 활성 글은 WARN 이다.
    og = re.search(r'<meta\s+property="og:description"\s+content="([^"]*)"', head_ns)
    blocks, bad_json = jsonld_blocks(head)
    for e in bad_json:
        fails.append("JSON-LD 파싱 실패 — %s" % e)

    ld_desc = None
    for b in blocks:
        if isinstance(b, dict) and b.get("@type") == "Article":
            ld_desc = b.get("description")
            break

    if dm:
        vals = {"meta": decode_entities(dm.group(1))}
        if og:
            vals["og"] = decode_entities(og.group(1))
        if ld_desc:
            vals["JSON-LD"] = ld_desc
        if len(set(vals.values())) > 1:
            msg = "description 불일치 — " + " / ".join(
                "%s %d자" % (k, len(v)) for k, v in vals.items())
            if injected:
                warns.append(msg + " (맵 주입 활성 — 라이브에서는 meta 만 맵 문구로 갈린다)")
            else:
                fails.append(msg)

    # ── 4. ⓑ FAQ 공백 정규화 중복 검사 ───────────────────────────
    # 2026-10-15 결함의 재발 방지. 본문 details/summary 와 JSON-LD
    # FAQPage Question 을 각각 따로 본다 — 한쪽만 중복인 경우가 있다.
    summaries = [m.group(2) for m in re.finditer(
        r"<details(?![^>]*\sclass=)\b[^>]*>\s*(<summary\b[^>]*>)(.*?)</summary>",
        s, re.S | re.I)]
    seen = {}
    for q in summaries:
        k = norm_question(q)
        if not k:
            continue
        seen.setdefault(k, []).append(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", q)).strip())
    for k, group in seen.items():
        if len(group) > 1:
            fails.append("FAQ 본문 중복 %d건 (공백·물음표 무시 시 동일) — %s"
                         % (len(group), " | ".join(group[:3])))

    faq_q = []
    for b in blocks:
        if isinstance(b, dict) and b.get("@type") == "FAQPage":
            for q in b.get("mainEntity", []) or []:
                if isinstance(q, dict) and q.get("name"):
                    faq_q.append(q["name"])
    seen2 = {}
    for q in faq_q:
        seen2.setdefault(norm_question(q), []).append(q)
    for k, group in seen2.items():
        if len(group) > 1:
            fails.append("JSON-LD FAQPage 중복 %d건 — %s"
                         % (len(group), " | ".join(group[:3])))

    # details 와 JSON-LD 개수 동기화. FAQPage 가 아예 없는 글은 건너뛴다.
    # ★ class 가 붙은 details 는 FAQ 가 아니다. 전 글에 깔린
    # <details class="series-all"> 는 시리즈 목차 네비게이션이다(전수 32개).
    # 최초 구현이 이걸 FAQ 로 세어 "details N ≠ Question N-1" 오탐을
    # 20편 넘게 만들었다. FAQ 는 class 없는 details 로 통일돼 있다(362개).
    n_det = len(re.findall(r"<details(?![^>]*\sclass=)\b[^>]*>", s, re.I))
    if faq_q and n_det and n_det != len(faq_q):
        # ★ FAIL 이 아니라 WARN 이다. 2026-10-19 전수 실측에서 걸린 2건이
        # 둘 다 "의도된 제외"였다 — sangsokse 편의 마지막 details 는
        # '이 글의 숫자를 그대로 믿어도 되나요'(면책 고지)이고, suyong-toji 편은
        # '세꼼이 계산기로 계산할 수 있나요'(자기 홍보)다. 면책과 홍보를
        # FAQPage 리치결과에 넣지 않는 것은 합리적인 선택이다.
        # 기계가 판정할 수 없는 종류라 사람에게 넘긴다.
        warns.append("details %d개 ≠ FAQPage Question %d개 — 의도된 제외인지 확인 필요"
                     % (n_det, len(faq_q)))

    # ── 5. 목차 앵커 ─────────────────────────────────────────────
    # 깨진 앵커는 GSC 가 별도 URL 로 세는 구조와 맞물려 손해가 크다(10/16 기록).
    ids = set(re.findall(r'\sid="([^"]+)"', s))
    for a in set(re.findall(r'href="#([^"]+)"', s)):
        if a and a not in ids:
            fails.append("목차 앵커 #%s 에 대응하는 id 없음" % a)

    # ── 6. 내부링크 대상 실재 ────────────────────────────────────
    slug = os.path.basename(path)[:-5]
    targets = set(re.findall(r'href="/blog/([a-z0-9\-]+)"', s))
    targets.discard(slug)
    for t in sorted(targets):
        if not os.path.exists(os.path.join(BLOG_DIR, t + ".html")):
            fails.append("내부링크 대상 파일 없음 — /blog/%s" % t)
    if len(targets) < 3:
        warns.append("내부링크 %d개 (신규 글 기준 최소 3개)" % len(targets))

    # ── 7. 이전 글 slug 이월 ─────────────────────────────────────
    # 템플릿 tail 의 추적 스크립트가 남의 이름을 달고 나간 사고(8/13).
    aids = re.findall(r"article_id:\s*'([^']+)'", s)
    if aids:
        wrong = [a for a in set(aids) if a != slug]
        if wrong:
            fails.append("article_id 가 자기 slug 와 불일치 — %s (파일 %s)"
                         % (", ".join(wrong), slug))
        if aids.count(slug) > 1:
            warns.append("article_id 가 %d회 중복 기재" % aids.count(slug))

    # ── 8. canonical 자기 일치 ───────────────────────────────────
    cm = re.search(r'<link\s+rel="canonical"\s+href="([^"]*)"', head_ns)
    if cm and not cm.group(1).rstrip("/").endswith("/" + slug):
        fails.append("canonical 이 자기 slug 와 불일치 — %s" % cm.group(1))

    # ── 9. 사용 클래스가 style 에 있는지 ─────────────────────────
    stm = re.search(r"<style\b[^>]*>(.*?)</style>", s, re.S | re.I)
    if stm:
        css = stm.group(1)
        used = set()
        for m in re.finditer(r'class="([^"]+)"', s):
            used.update(m.group(1).split())
        # 템플릿이 전 글에 심어 둔 수식 클래스. 자체 CSS 규칙이 없을 뿐
        # 깨진 것이 아니다(2026-10-19 전수 확인 — 64/64 파일에 동일 등장).
        BENIGN = {"prev", "next"}
        missing = sorted(c for c in used
                         if ("." + c) not in css and c not in BENIGN)
        if missing:
            warns.append("style 에 정의 없는 클래스 %d개 — %s"
                         % (len(missing), ", ".join(missing[:8])))

    return fails, warns


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    quiet = "--quiet" in sys.argv
    # 파일을 명시해 부르면 = 그 파일을 지금 커밋하려는 것이다. 이때는
    # 맵 주입 활성도 FAIL 로 올린다(강화 문구가 조용히 되돌려지는 바로 그 상황).
    # 인자 없는 전수 점검에서는 36편의 상태일 뿐이므로 WARN 이다.
    strict = bool(args) or "--strict" in sys.argv
    desc_map = load_desc_map()

    if args:
        files = args
    else:
        files = sorted(
            os.path.join(BLOG_DIR, f)
            for f in os.listdir(BLOG_DIR)
            if f.endswith(".html") and f not in NOT_ARTICLE
        )

    n_fail_files = 0
    n_fail = n_warn = 0
    for p in files:
        fails, warns = check_file(p, desc_map, strict)
        n_fail += len(fails)
        n_warn += len(warns)
        if fails:
            n_fail_files += 1
        if not fails and not warns and quiet:
            continue
        if not fails and quiet:
            continue
        status = "FAIL" if fails else ("WARN" if warns else "ok")
        print("[%s] %s" % (status, os.path.basename(p)))
        for f in fails:
            print("   FAIL  " + f)
        if not quiet:
            for w in warns:
                print("   warn  " + w)

    print("\n%d개 파일 검사 — FAIL %d건(%d파일) · WARN %d건"
          % (len(files), n_fail, n_fail_files, n_warn))
    return 1 if n_fail else 0


if __name__ == "__main__":
    sys.exit(main())
