#!/usr/bin/env node
/* 계산기 법령 회귀 테스트 — tools/tax/calc-law-test.cjs (2026-11-24 신설)
   사용: node tools/tax/calc-law-test.cjs   (레포 루트에서)
   _parts/index.html.part* 를 조립해 계산 엔진(isAdj·temp2Months·calc)을 떼어 내 실행한다.
   FAIL 이 하나라도 있으면 exit 1 → 그날 자동화는 블로그보다 계산기 수정을 먼저 한다(운영 기준 §16).
   ★ 법이 바뀌면(공포·시행) 이 파일에 기대값을 먼저 추가하고, 테스트가 FAIL 하면 계산기를 고친다.
   기대값의 근거는 각 줄 주석에 적는다. 근거 없는 기대값을 넣지 않는다. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..', '..');
const dir = path.join(root, '_parts');
const files = fs.readdirSync(dir).filter(f => /^index\.html\.part\d+$/.test(f)).sort();
const s = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
function grab(start, end) { const i = s.indexOf(start); if (i < 0) throw new Error('marker not found: ' + start); const j = s.indexOf(end, i); return s.slice(i, j); }
const code = ['let A={};', 'const NOWY=2026,NOWM=11;',
  grab('const ymNum=', 'function fmtMan('),
  grab('function addMonths(', '\n') + '\n',
  grab('const RX_GG_1015', '/* ================= flow'),
  grab('const BR=', '/* ================= scenarios'),
  'this.E={isAdj,adjHistoryUnknown,temp2Months,calc,setA:a=>{A=a}};'].join('\n');
const ctx = {}; vm.createContext(ctx); vm.runInContext(code, ctx); const E = ctx.E;

let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fail++; console.log('FAIL ' + m); } else console.log('ok   ' + m); };
const base = o => Object.assign({ salePrice: 90000, acqPrice: 60000, acqExp: 1500, saleExp: 500, acqDate: { y: 2020, m: 6 }, saleDate: { y: 2026, m: 12 },
  currentlyLiving: false, resMonthsAtSale: 0, resMonthsNow: 0, ptype: 'apartment', offiUse: null, otherCount: 0, memberOtherHouse: false, otherAcq: null,
  address: { region: '서울 마포구' }, acqAdj: false, isResident: true, own: 'single', myShare: 100, members: [], resRatio: 100 }, o);
const run = a => { E.setA(JSON.parse(JSON.stringify(a))); return E.calc(); };

// [1] 조정대상지역 현행 — 서울 25개구 + 경기 12곳(10·15 대책, 2025-10-16 효력) + 3곳(2026-07-01 효력)
['서울 강남구', '서울 도봉구', '경기 과천시', '경기 광명시', '경기 의왕시', '경기 하남시', '경기 성남시 분당구', '경기 성남시 수정구', '경기 성남시 중원구',
 '경기 수원시 영통구', '경기 수원시 장안구', '경기 수원시 팔달구', '경기 안양시 동안구', '경기 용인시 수지구', '경기 화성시 동탄구', '경기 용인시 기흥구', '경기 구리시']
  .forEach(r => ok(E.isAdj(r, 2026, 11) === true, '현행 조정 ' + r));
['경기 수원시 권선구', '경기 안양시 만안구', '경기 고양시 일산동구', '인천 연수구', '부산 해운대구'].forEach(r => ok(E.isAdj(r, 2026, 11) === false, '현행 비조정 ' + r));
ok(E.isAdj('경기 수원시 영통구', 2025, 9) === false, '영통 2025-09 지정 전');
ok(E.isAdj('경기 용인시 기흥구', 2026, 6) === false, '기흥 2026-06 지정 전');
ok(E.isAdj('서울 마포구', 2024, 5) === false, '마포 2024-05 (2023-01-05 해제 ~ 2025-10-16 재지정 사이)');
ok(E.adjHistoryUnknown('경기 수원시 영통구', 2021, 6) === true, '2016-11~2022-12 이력 미반영 지역은 고지 대상');

// [2] 세율·중과 — 소득세법 §55·§104, 중과 유예 2026-05-09 종료
let r = run(base({ address: { region: '경기 수원시 영통구' }, otherCount: 1, otherAcq: { y: 2018, m: 1 } }));
ok(r.surcharge === 20 && Math.round(r.total) === 15511, '조정 2주택 중과 +20%p·장특공 배제 → 15,511만 (수기: (27,750×58%−1,994)×1.1)');
r = run(base({ address: { region: '부산 해운대구' }, otherCount: 1, otherAcq: { y: 2018, m: 1 } }));
ok(r.surcharge === 0 && r.ltdRate === 12, '비조정 2주택 중과 없음·장특공 표1 6년 12%');

// [3] 1세대1주택 비과세 거주요건 — 취득 당시 조정대상지역
const b = base({ acqDate: { y: 2025, m: 12 }, saleDate: { y: 2027, m: 12 }, address: { region: '경기 수원시 영통구' } });
b.acqAdj = E.isAdj('경기 수원시 영통구', 2025, 12);
r = run(b); ok(!r.exempt && Math.round(r.total) === 9406, '영통 2025-12 취득·무거주 → 비과세 아님 9,406만');

// [4] 일시적 2주택 — 소득세법 시행령 개정 2026-10-01 시행: 조정→조정, 신규 2026-08-04 이후 취득 + 2026-10-01 이후 양도 → 2년
const c = base({ acqDate: { y: 2015, m: 3 }, acqAdj: true, resMonthsNow: 60, resMonthsAtSale: 60, otherCount: 1, otherAcq: { y: 2026, m: 9 }, saleDate: { y: 2028, m: 12 } });
ok(!run(Object.assign({}, c, { otherAdj: true })).exempt, '조정→조정 27개월 → 비과세 아님');
ok(run(Object.assign({}, c, { otherAdj: true, saleDate: { y: 2028, m: 8 } })).exempt, '조정→조정 23개월 → 비과세');
ok(run(Object.assign({}, c, { otherAdj: false })).exempt, '신규주택 비조정 → 3년 유지');
ok(run(Object.assign({}, c, { otherAdj: true, otherAcq: { y: 2026, m: 7 } })).exempt, '신규 2026-07 취득 → 3년 유지');

// [5] 12억 비과세·고가주택 안분, 상가주택 12억 이하
r = run(base({ salePrice: 100000, acqDate: { y: 2015, m: 3 }, resMonthsNow: 60, resMonthsAtSale: 60 })); ok(Math.round(r.total) === 0, '1세대1주택 10억 비과세');
r = run(base({ ptype: 'mixed', resRatio: 70, salePrice: 100000, acqDate: { y: 2015, m: 3 }, resMonthsNow: 60, resMonthsAtSale: 60, address: { region: '경기 고양시 일산동구' } }));
ok(Math.round(r.total) === 0, '상가주택 12억 이하·주거 70% → 전부 주택, 비과세');

// [6] 2026 세법개정안(국회 심사 중) — 2027년 이후 양도일 고지가 결과 화면에 있어야 한다(2026-11-25).
//     의결되면 tools/tax/reform-2026/reform.cjs 로 엔진을 바꾸고, 이 테스트는 '반영됨' 문구 확인으로 바꾼다.
ok(s.includes('data-reform="2026-pending"') && s.includes('ymNum(A.saleDate.y,A.saleDate.m)>=ymNum(2027,1)'), '2027년 이후 양도 — 개정안 심사 중 고지 존재');

console.log((fail ? 'FAIL ' + fail + ' / ' : 'ALL PASS ') + n + ' tests');
process.exit(fail ? 1 : 0);
