#!/usr/bin/env node
/* 증여세 엔진 법령 회귀 테스트 — tools/tax/gift-law-test.cjs (2026-11-24 신설)
   사용: node tools/tax/gift-law-test.cjs   (레포 루트에서)
   FAIL 이 하나라도 있으면 exit 1. 운영 기준 §16의 [C0]이 calc-law-test.cjs 와 함께 돌린다.
   기대값은 손계산으로 먼저 정하고 각 줄 주석에 식을 적는다. 엔진이 낸 값을 기대값으로 옮겨 적지 않는다.
   예외: [양도 엔진 회귀값]이라고 표시한 줄은 손계산이 아니라 양도 엔진 출력의 고정값이다. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..', '..');
const G = require(path.join(__dirname, 'gift-engine.cjs'));

let fail = 0, n = 0;
const eq = (a, b, m) => { n++; const ok = Math.abs(a - b) < 0.01; if (!ok) fail++; console.log((ok ? 'ok   ' : 'FAIL ') + m + ' = ' + Math.round(a * 100) / 100 + (ok ? '' : ' (기대 ' + b + ')')); };
const is = (c, m) => { n++; if (!c) fail++; console.log((c ? 'ok   ' : 'FAIL ') + m); };

// [1] 세율표(§56·§26) 구간 경계 — 「기본금액 + 초과분 × 세율」 식과 누진공제 식이 같은 값을 내야 한다
[[10000, 1000], [50000, 9000], [100000, 24000], [300000, 104000], [500000, 204000]].forEach(([b, e]) => eq(G.giftRateTax(b), e, '세율 경계 ' + b / 10000 + '억'));

// [2] 증여재산공제(§53) — 2025-03-14 이후 기타친족 4촌 혈족·3촌 인척
eq(G.groupLimit('spouse'), 60000, '배우자 6억'); eq(G.groupLimit('ascendant', false), 5000, '직계존속→성년 5천만');
eq(G.groupLimit('ascendant', true), 2000, '직계존속→미성년 2천만'); eq(G.groupLimit('descendant'), 5000, '직계비속 5천만'); eq(G.groupLimit('other_kin'), 1000, '기타친족 1천만');

let r;
// [3] 기본 사례
r = G.giftTax({ rel: 'ascendant', value: 10000 }); eq(r.giftTax, 485, 'T1 부모→성년 자녀 현금 1억: (1억−5천)×10%×0.97');
r = G.giftTax({ rel: 'ascendant', value: 10000, fileOnTime: false }); eq(r.giftTax, 500, 'T1b 기한 후 신고 → 3% 공제 없음');
r = G.giftTax({ rel: 'spouse', value: 60000 }); eq(r.giftTax, 0, 'T2 배우자 6억 → 0');
r = G.giftTax({ rel: 'spouse', value: 70000 }); eq(r.giftTax, 970, 'T2b 배우자 7억: 1억×10%×0.97');
// [4] 과세최저한 §55② — 과세표준 50만 미만 부과 안 함
r = G.giftTax({ rel: 'other_kin', value: 1040 }); is(r.giftTax === 0 && r.belowMin, 'T3 기타친족 1,040만 → 과세표준 40만 → 0');
r = G.giftTax({ rel: 'other_kin', value: 1060 }); eq(r.giftTax, 5.82, 'T3b 기타친족 1,060만 → 60만×10%×0.97');
// [5] 세대생략 할증 §57
r = G.giftTax({ rel: 'ascendant', minor: true, skipGeneration: true, value: 30000 }); eq(r.giftTax, 5800.6, 'T4 조부→미성년 손자 3억: (2.8억×20%−1천만)×1.3×0.97');
r = G.giftTax({ rel: 'ascendant', minor: true, skipGeneration: true, value: 210000 }); eq(r.giftTax, 91257.6, 'T4b 미성년·20억 초과 40%: (20.8억×40%−1.6억)×1.4×0.97');
r = G.giftTax({ rel: 'ascendant', minor: true, skipGeneration: false, value: 30000 }); eq(r.giftTax, 4462, 'T4c 중간 세대 사망 대습 → 할증 없음: 4,600×0.97');
// [6] 혼인·출산 공제 §53의2
r = G.giftTax({ rel: 'ascendant', value: 15000, marriageBirth: { eligible: true } }); eq(r.giftTax, 0, 'T5 혼인 공제 1억 + 5천 → 1억5천까지 0');
r = G.giftTax({ rel: 'ascendant', value: 16000, marriageBirth: { eligible: true } }); eq(r.giftTax, 97, 'T5b 1억6천 → 1천만×10%×0.97');
r = G.giftTax({ rel: 'ascendant', value: 15000, marriageBirth: { eligible: true, usedBefore: 10000 } }); eq(r.giftTax, 970, 'T5c 출산 공제 1억 이미 사용 → 혼인 공제 0 → 1억×10%×0.97');
r = G.giftTax({ rel: 'other_kin', value: 15000, marriageBirth: { eligible: true } }); eq(r.mbDeduct, 0, 'T5d 직계존속이 아니면 혼인 공제 없음');
// [7] 10년 합산 §47② · 납부세액공제 §58
r = G.giftTax({ rel: 'ascendant', value: 5000, priorSameDonor: { value: 5000, calcTax: 0 } }); eq(r.giftTax, 485, 'T6 아버지 5천(10년 내) + 어머니 5천 → 합산 1억, 공제 5천 1회');
r = G.giftTax({ rel: 'ascendant', value: 5000, deductUsedOther: 5000 }); eq(r.giftTax, 485, 'T7 할아버지에게 받을 때 공제 5천 소진, 아버지 5천 → 합산 없이 공제 0');
r = G.giftTax({ rel: 'ascendant', value: 5000, priorSameDonor: { value: 900, calcTax: 0 } }); is(r.priorAdded === 0 && r.giftTax === 0, 'T8 종전 증여 합 900만(<1천만) → 가산 안 함');
r = G.giftTax({ rel: 'ascendant', value: 20000, priorSameDonor: { value: 30000, calcTax: 4000 } }); eq(r.giftTax, 3880, 'T9 종전 3억(산출 4천) + 이번 2억: (4.5억×20%−1천)−4천 = 4천 ×0.97');
// [8] 증여 취득세 지방세법 §11·§13의2
r = G.giftTax({ rel: 'ascendant', value: 80000, re: { adj: true, stdPrice3eok: true, donorOneHouse: true, over85: false } });
eq(r.giftTax, 16005, 'T10 아파트 8억 증여세: (7.5억×30%−6천)×0.97'); eq(r.acqTax, 3040, 'T10 취득세: 1세대1주택자 증여 → 중과 제외 3.8%');
r = G.giftTax({ rel: 'ascendant', value: 80000, re: { adj: true, stdPrice3eok: true, donorOneHouse: false, over85: false } }); eq(r.acqTax, 9920, 'T11 증여자 다주택·조정·3억↑ → 12%+0.4%');
r = G.giftTax({ rel: 'ascendant', value: 80000, re: { adj: true, stdPrice3eok: true, donorOneHouse: false, over85: true } }); eq(r.acqTax, 10720, 'T11b 같은 조건 85㎡ 초과 → 농특 1.0% 더해 13.4%');
r = G.giftTax({ rel: 'ascendant', value: 80000, re: { adj: false, stdPrice3eok: true, donorOneHouse: false, over85: true } }); eq(r.acqTax, 3200, 'T11c 비조정 → 3.5%+0.3%+0.2% = 4.0%');
r = G.giftTax({ rel: 'other_kin', value: 80000, re: { adj: true, stdPrice3eok: true, donorOneHouse: true, over85: false } }); eq(r.acqTax, 9920, 'T11d 1세대1주택자라도 기타친족에게 증여 → 중과 제외 대상 아님');
r = G.giftTax({ rel: 'ascendant', value: 50000, re: { isHouse: false, adj: true, stdPrice3eok: true, donorOneHouse: false } }); eq(r.acqTax, 2000, 'T12 토지·상가 5억 → 중과 없음 4.0%');
// [9] 부담부증여
r = G.giftTax({ rel: 'ascendant', value: 80000, debt: 40000, re: { adj: true, stdPrice3eok: true, donorOneHouse: true, over85: false } });
eq(r.giftTax, 5820, 'T13 부담부(8억·채무 4억) 증여세: (4억−5천)×20%−1천 = 6천 ×0.97');
eq(r.acqTax, 1960, 'T13 취득세: 증여분 4억×3.8% + 채무분 4억×1.1%(간이)'); is(r.notes.includes('acq_debt_approx'), 'T13 채무분 취득세는 간이 표시');
const bt = G.burdenTransfer(80000, 40000, 40000); is(bt.salePrice === 40000 && bt.acqPrice === 20000, 'T14 증여자 양도: 양도가액 4억, 취득가액 4억×4/8 = 2억');
// [10] 신고기한 §68 — 증여일이 속한 달 말일부터 3개월
let d = G.fileDeadline(2026, 11); is(d.y === 2027 && d.m === 2 && d.d === 28, 'T15 2026-11 증여 → 2027-02-28');
d = G.fileDeadline(2026, 12); is(d.y === 2027 && d.m === 3 && d.d === 31, 'T15b 2026-12 증여 → 2027-03-31');

// [11] 부담부증여 증여자 양도세 — 계산기 본체의 양도 엔진을 그대로 돌린다
const dir = path.join(root, '_parts');
const s = fs.readdirSync(dir).filter(f => /^index\.html\.part\d+$/.test(f)).sort().map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
const grab = (a, b) => { const i = s.indexOf(a); if (i < 0) throw new Error('marker not found: ' + a); return s.slice(i, s.indexOf(b, i)); };
const ctx = {}; vm.createContext(ctx);
vm.runInContext(['let A={};', 'const NOWY=2026,NOWM=11;', grab('const ymNum=', 'function fmtMan('), grab('function addMonths(', '\n') + '\n',
  grab('const RX_GG_1015', '/* ================= flow'), grab('const BR=', '/* ================= scenarios'), 'this.Y={calc,setA:a=>{A=a}};'].join('\n'), ctx);
const donorCGT = oneHouse => { ctx.Y.setA({ salePrice: bt.salePrice, acqPrice: bt.acqPrice, acqExp: 0, saleExp: 0, acqDate: { y: 2017, m: 1 }, saleDate: { y: 2026, m: 12 },
  currentlyLiving: true, resMonthsAtSale: 108, resMonthsNow: 108, ptype: 'apartment', offiUse: null, otherCount: oneHouse ? 0 : 1, otherAcq: oneHouse ? null : { y: 2010, m: 1 },
  memberOtherHouse: false, address: { region: '서울 마포구' }, acqAdj: false, isResident: true, own: 'single', myShare: 100, members: [], resRatio: 100 }); return ctx.Y.calc().total; };
eq(donorCGT(true), 0, 'T16 증여자 1세대1주택(양도가액 4억 ≤ 12억) → 채무분 양도세 0');
eq(Math.round(donorCGT(false)), 10407, 'T16b [양도 엔진 회귀값] 증여자 조정 2주택 → 중과, 채무분 양도세 10,407만');

console.log((fail ? 'FAIL ' + fail + ' / ' : 'ALL PASS ') + n + ' tests');
process.exit(fail ? 1 : 0);
