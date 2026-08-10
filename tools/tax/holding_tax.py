# -*- coding: utf-8 -*-
"""
세꼼이 보유세(재산세 + 종합부동산세) 계산 엔진
신설 2026-08-10 (오너 승인) — 뉴스핌 정영희 기자 2차 취재 요청 대응으로 만들어졌다.

세꼼이 본체는 양도소득세 계산 서비스이며 이 모듈은 그 범위 밖이다.
계산기 프론트/백엔드와 연결되어 있지 않은 독립 스크립트이며,
언론 제공 자료와 블로그 글의 수치 산출에만 쓴다.

━━━ 반드시 읽을 것 ━━━
[한계 1] 절대액이 언론 시뮬레이션과 어긋난다.
  - 반포자이 84㎡ 거주 1주택 보유세: 우병탁 위원 2,763만 vs 본 엔진 2,309만 (본 엔진이 낮음)
  - 한국일보 보도 마래푸 401동 종부세: 본 엔진이 높음
  방향이 반대라 단순 항목 누락이 아니다. 과표 6~12억 위쪽 구간(12~25억·25~50억)의
  개편안 세율이 함께 올랐는지가 유력 가설이며, 입법예고 조문(기한 2026-08-20)으로 풀린다.
  → 해소 전까지 대외 자료는 **절대액이 아니라 명의 구조별 차액**을 중심으로 제시한다.
     차액은 동일 엔진 내 비교라 계통 오차가 상쇄된다.

[한계 2] 세부담 상한(현행 150% → 개편안 200%)은 직전연도 세액이 필요해 미반영이다.
         실제 고지세액은 본 엔진 결과보다 낮을 수 있다.

[한계 3] 지역자원시설세는 재산세에 포함하지 않았다.

[미확정] 개편안은 2026-08-03 발표 정부안이며 국회 미제출·미확정이다.
         공동명의 특례 미신청 시 각자 받는 일반 기본공제 9억이 개편안에서 유지되는지는
         조문 미확인이며, 본 엔진은 '유지'로 가정한다.
"""

EOK = 100_000_000  # 1억

# ── 개편안 파라미터 (2026-08-03 정부안, 2027년 적용분) ────────────────
REFORM_DEDUCTION_RESIDENT = 14 * EOK     # 거주 1주택 기본공제
REFORM_DEDUCTION_NONRESIDENT = 9 * EOK   # 비거주 1주택 기본공제
REFORM_DEDUCTION_GENERAL = 9 * EOK       # 1세대1주택자가 아닌 자의 일반 기본공제 (유지 가정)
REFORM_FAIR_RATIO = 0.70                 # 1주택 공정시장가액비율 60% → 70%
                                         # (근거: fnnews.com/news/202608040621262145, 2026-08-04)
CURRENT_DEDUCTION_ONE_HOUSE = 12 * EOK
CURRENT_DEDUCTION_GENERAL = 9 * EOK
CURRENT_FAIR_RATIO = 0.60


# ── 재산세 ────────────────────────────────────────────────────────────

def rp_fair_ratio(gongsi, one_house_special=True):
    """주택분 재산세 공정시장가액비율 (1세대 1주택 특례 43~45%, 2026 기준)"""
    if not one_house_special:
        return 0.60
    if gongsi <= 3 * EOK:
        return 0.43
    if gongsi <= 6 * EOK:
        return 0.44
    return 0.45


def rp_standard_tax(base):
    """재산세 주택 표준세율"""
    if base <= 60_000_000:
        return base * 0.001
    if base <= 150_000_000:
        return 60_000 + (base - 60_000_000) * 0.0015
    if base <= 300_000_000:
        return 195_000 + (base - 150_000_000) * 0.0025
    return 570_000 + (base - 300_000_000) * 0.004


def rp_special_tax(base):
    """1세대 1주택 특례세율 (공시가격 9억 이하 주택만)"""
    if base <= 60_000_000:
        return base * 0.0005
    if base <= 150_000_000:
        return 30_000 + (base - 60_000_000) * 0.001
    if base <= 300_000_000:
        return 120_000 + (base - 150_000_000) * 0.002
    return 420_000 + (base - 300_000_000) * 0.0035


def property_tax(gongsi, one_house=True):
    """주택 재산세 = 본세 + 도시지역분(0.14%) + 지방교육세(본세의 20%)

    재산세는 거주 여부·명의 구조와 무관하다. 개편안의 대상도 아니다.
    따라서 거주/비거주 차이는 전액 종부세에서 발생한다.
    """
    ratio = rp_fair_ratio(gongsi, one_house_special=one_house)
    base = gongsi * ratio
    use_special = one_house and gongsi <= 9 * EOK
    main = rp_special_tax(base) if use_special else rp_standard_tax(base)
    return {
        "ratio": ratio,
        "base": base,
        "main": main,
        "standard_main": rp_standard_tax(base),  # 중복분 공제 계산용
        "urban": base * 0.0014,
        "edu": main * 0.2,
        "total": main + base * 0.0014 + main * 0.2,
    }


# ── 종합부동산세 ──────────────────────────────────────────────────────

RATE_CURRENT = [  # 2주택 이하 기본세율 (현행)
    (3 * EOK, 0.005), (6 * EOK, 0.007), (12 * EOK, 0.010),
    (25 * EOK, 0.013), (50 * EOK, 0.015), (94 * EOK, 0.020),
    (float("inf"), 0.027),
]

RATE_REFORM = [  # 개편안: 가액 기준 일원화 (2026-08-10 정정, tools/tax/RATE_CORRECTION.md)
    (3 * EOK, 0.005), (6 * EOK, 0.007), (12 * EOK, 0.013),
    (25 * EOK, 0.020), (50 * EOK, 0.030), (94 * EOK, 0.040),
    (float("inf"), 0.050),
]
# ※ 2028년 완성형(가액 일원화) 기준. 2027년 중간단계 세율은 입법예고 조문 미확인.


def progressive(base, table):
    tax, prev = 0.0, 0.0
    for cap, rate in table:
        if base <= prev:
            break
        tax += (min(base, cap) - prev) * rate
        prev = cap
    return tax


def jongbuse(gongsi_share, deduction, *, reform=False, fair_ratio=None,
             credit_rate=0.0, one_house_rp=True, gongsi_full=None):
    """
    gongsi_share : 납세의무자에게 귀속되는 공시가격 (특례 신청 시 주택 전체)
    deduction    : 기본공제액
    credit_rate  : 고령자 + 장기보유 세액공제율 합계 (0~0.8), 1세대1주택자만
    gongsi_full  : 재산세 중복분 공제용 물건 전체 공시가격
    """
    if fair_ratio is None:
        fair_ratio = REFORM_FAIR_RATIO if reform else CURRENT_FAIR_RATIO
    if gongsi_full is None:
        gongsi_full = gongsi_share

    table = RATE_REFORM if reform else RATE_CURRENT
    base = max(0.0, gongsi_share - deduction) * fair_ratio
    gross = progressive(base, table)

    # 재산세 중복분 공제 (종합부동산세법 시행령 §4의2)
    rp = property_tax(gongsi_full, one_house=one_house_rp)
    share = gongsi_share / gongsi_full if gongsi_full else 1.0
    rp_main_share = rp["main"] * share
    rp_std_share = rp["standard_main"] * share
    if base > 0 and rp_std_share > 0:
        deduct_rp = min(gross, rp_main_share * rp_standard_tax(base * rp["ratio"]) / rp_std_share)
    else:
        deduct_rp = 0.0

    after_rp = max(0.0, gross - deduct_rp)
    after_credit = after_rp * (1 - credit_rate)
    return {
        "base": base, "gross": gross, "deduct_rp": deduct_rp,
        "after_rp": after_rp, "credit_rate": credit_rate,
        "jbs": after_credit,
        "farm": after_credit * 0.2,          # 농어촌특별세
        "total": after_credit * 1.2,
    }


# ── 시나리오 (1주택 · 부부 50:50 공동명의) ────────────────────────────

def single_owner(gongsi, *, reform=False, resident=True, credit_rate=0.0):
    """단독명의 1주택 (= 공동명의 특례 신청 시와 계산 구조 동일)"""
    if reform:
        ded = REFORM_DEDUCTION_RESIDENT if resident else REFORM_DEDUCTION_NONRESIDENT
    else:
        ded = CURRENT_DEDUCTION_ONE_HOUSE
    return jongbuse(gongsi, ded, reform=reform, credit_rate=credit_rate, gongsi_full=gongsi)


def joint_special(gongsi, *, reform=False, resident=True, credit_rate=0.0):
    """공동명의 1주택 · 특례 신청 (종부세법 §10의2, 1주택자 의제)"""
    return single_owner(gongsi, reform=reform, resident=resident, credit_rate=credit_rate)


def joint_no_special(gongsi, *, reform=False):
    """공동명의 1주택 · 특례 미신청 — 부부가 각자 일반 기본공제, 세액공제 없음

    ★ 이 함수가 2026-08-10 발견의 핵심이다.
      개편안의 '비거주 1주택 9억'은 일반 기본공제 9억과 같은 금액이므로,
      부부가 각자 9억씩 합 18억을 받는 이 경로가 비거주자에겐 언제나 유리해진다.
      = 비거주 강화 조항이 명의 분산만으로 비켜간다.
    """
    ded = REFORM_DEDUCTION_GENERAL if reform else CURRENT_DEDUCTION_GENERAL
    r = jongbuse(gongsi / 2, ded, reform=reform, credit_rate=0.0, gongsi_full=gongsi)
    doubled = {"credit_rate": 0.0, "base": r["base"]}
    for k in ("gross", "deduct_rp", "after_rp", "jbs", "farm", "total"):
        doubled[k] = r[k] * 2
    return doubled


def man(x):
    """원 → 만원 문자열"""
    return f"{round(x / 10_000):,}"


if __name__ == "__main__":
    # 2026년 공동주택 공시가격 (뉴시스 2026-03-17 보도, 우병탁 위원 시뮬레이션 인용)
    # 마래푸는 출처가 엇갈려(한국일보 401동 역산 약 20.9억 / 중앙일보 역산 약 17.8억) 세 값 병기
    cases = [
        ("반포자이 84㎡ (33.86억)", 3_386_210_000),
        ("은마아파트 84㎡ (25.80억)", 2_580_240_000),
        ("마래푸 84㎡ (17.5억 가정)", 1_750_000_000),
        ("마래푸 84㎡ (18.0억 가정)", 1_800_000_000),
        ("마래푸 84㎡ (20.0억 가정)", 2_000_000_000),
    ]
    print("종부세(농특세 포함), 만원 · 재산세는 명의·거주와 무관하여 제외")
    print(f'{"단지":30s}{"현행단독":>10}{"개편거주":>10}{"개편비거주":>11}{"개편부부공동":>13}')
    for name, g in cases:
        a = single_owner(g, reform=False)["total"]
        b = single_owner(g, reform=True, resident=True)["total"]
        c = single_owner(g, reform=True, resident=False)["total"]
        d = joint_no_special(g, reform=True)["total"]
        print(f'{name:30s}{man(a):>10}{man(b):>10}{man(c):>11}{man(d):>13}')
