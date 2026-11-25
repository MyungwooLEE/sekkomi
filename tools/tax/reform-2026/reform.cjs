#!/usr/bin/env node
/* 2026 세법개정안 반영 패치 — tools/tax/reform-2026/reform.cjs (2026-11-25 준비)
 *
 * 국회 통과 전에 미리 만들어 둔 계산기 패치다. 이 폴더는 배포되지 않는다(_parts를 건드리지 않는 한).
 *
 *   node tools/tax/reform-2026/reform.cjs           → _parts를 메모리에서 패치해 아래 테스트만 돌린다(파일 변경 없음)
 *   node tools/tax/reform-2026/reform.cjs --write   → _parts/index.html.part* 에 실제로 적용하고 index.sha256을 갱신한다
 *
 * ★ --write는 국회 의결 후에만 쓴다. 순서: params.json을 의결안 원문 값으로 고친다 → 아래 기대값을 원문 기준으로 고친다
 *   → 테스트 통과 확인 → --write → node tools/tax/calc-law-test.cjs → 결과 화면의 data-reform 고지 문구를 '반영됨'으로 바꾼다.
 * 반영 범위·근거·미반영 항목: claude/세제개편안-통과대비-2026-11-25.md (프로젝트 문서)
 *
 * 반영: R1 다주택 중과 한시 완화, R2 기본공제 2,500만(단독명의만), R3 장특공 2028·2029, R4 장특공 한도
 * 미반영: R1' 2026년 양도분 특례(범위 불명확), R5 거주기간 인정 특례, R6 고령자 감면, 특수관계인 양도 제외(입력 없음)
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const root = path.resolve(__dirname, '..', '..', '..');
const dir = path.join(root, '_parts');
const P = JSON.parse(fs.readFileSync(path.join(__dirname, 'params.json'), 'utf8'));
const J = JSON.stringify;

const bd = P.basicDeduction, lt = P.ltd, sc = P.surcharge;
const ONE = J({ '2028': lt.oneHouse['2028'], '2029': lt.oneHouse['2029'] });
const OTH = J({ '2028': lt.otherHousing['2028'], '2029': lt.otherHousing['2029'] });
const LY = "(saleD.y>=2029?'2029':saleD.y===2028?'2028':null)";

// [찾을 문자열(정확히 1회), 바꿀 문자열]
const REPL = [
  ['if(isHousing&&!exempt&&saleAdj&&heavyOn&&totalHouses>=2)surcharge=totalHouses>=3?30:20;',
   'if(isHousing&&!exempt&&saleAdj&&heavyOn&&totalHouses>=2){const _rs=' + J(sc.byYear) + '[saleD.y];' +
   'surcharge=(_rs&&holdMonths>=' + sc.minHoldMonths + ')?(totalHouses>=3?_rs[1]:_rs[0]):(totalHouses>=3?' + sc.default[1] + ':' + sc.default[0] + ')} // 2026 개정세법 R1'],
  ['    if(exempt&&resM>=24&&holdYears>=3){ltdRate=Math.min(40,holdYears*4)+Math.min(40,Math.floor(resM/12)*4)} // 표2: 보유 3년 이상 요건\n',
   '    const _ly=' + LY + ',_resY=Math.floor(resM/12); // 2026 개정세법 R3 — 2028·2029 장기거주 소득공제(주택)\n' +
   '    if(_ly&&isHousing&&exempt&&resM>=24&&holdYears>=3){const t=' + ONE + '[_ly];ltdRate=Math.min(t.hold[1],holdYears*t.hold[0])+Math.min(t.res[1],_resY*t.res[0])}\n' +
   '    else if(_ly&&isHousing){if(holdYears>=3){const t=' + OTH + '[_ly];ltdRate=Math.max(Math.min(t.hold[1],holdYears*t.hold[0]),resM>=24?Math.min(t.res[1],_resY*t.res[0]):0)}}\n' +
   '    else if(exempt&&resM>=24&&holdYears>=3){ltdRate=Math.min(40,holdYears*4)+Math.min(40,Math.floor(resM/12)*4)} // 표2: 보유 3년 이상 요건\n'],
  ['  const ltdAmt=taxableGain*ltdRate/100;\n',
   '  let ltdAmt=taxableGain*ltdRate/100;\n  {const _cap=' + J(lt.capManwon) + '[saleD.y>=2029?\'2029\':String(saleD.y)];if(_cap&&isHousing&&ltdAmt>_cap)ltdAmt=_cap} // 2026 개정세법 R4 — 공제 한도\n'],
  ['  // 명의 분할 계산\n',
   '  const basicDed=(saleD.y>=' + bd.fromYear + '&&exempt&&resM>=' + bd.minResMonths + '&&salePrice<=' + bd.maxSalePrice + (bd.singleOwnerOnly ? "&&A.own!=='joint'" : '') + ')?' + bd.amount + ':250; // 2026 개정세법 R2\n  // 명의 분할 계산\n'],
  ['    const myBase=Math.max(0,afterLtd*s/100-250);', '    const myBase=Math.max(0,afterLtd*s/100-basicDed);'],
  ['    exempt,exemptType,caseId,surcharge,', '    exempt,exemptType,caseId,basicDed,surcharge,'],
  ["bdRow('− 기본공제',(A.own==='joint'?'각 250만원':'250만원'),", "bdRow('− 기본공제',(A.own==='joint'?'각 250만원':fmtMan(R.basicDed||250)),"],
  ["R.afterLtd-(A.own==='joint'?250*(A.members.length+1):250)", "R.afterLtd-(A.own==='joint'?250*(A.members.length+1):(R.basicDed||250))"],
  ["같은 해에 여러 채를 팔면 한 번만 적용돼요.</span>'",
   "같은 해에 여러 채를 팔면 한 번만 적용돼요.'+(R.basicDed>250?' 10년 이상 거주한 1세대 1주택(양도가액 30억 원 이하)은 2027년 양도분부터 '+fmtMan(R.basicDed)+'이에요.':'')+'</span>'"],
];

const files = fs.readdirSync(dir).filter(f => /^index\.html\.part\d+$/.test(f)).sort();
const parts = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8'));
function patchParts(ps) {
  const out = ps.slice();
  for (const [a, b] of REPL) {
    const hits = out.map((p, i) => [i, p.split(a).length - 1]).filter(x => x[1] > 0);
    const total = hits.reduce((n, x) => n + x[1], 0);
    if (total !== 1) throw new Error('패치 지점이 정확히 1곳이 아님(' + total + '곳): ' + a.slice(0, 60));
    out[hits[0][0]] = out[hits[0][0]].replace(a, b);
  }
  return out;
}

const patched = patchParts(parts);
const s = patched.join('');
function grab(start, end) { const i = s.indexOf(start); if (i < 0) throw new Error('marker not found: ' + start); const j = s.indexOf(end, i); return s.slice(i, j); }
const code = ['let A={};', 'const NOWY=2026,NOWM=11;', grab('const ymNum=', 'function fmtMan('), grab('function addMonths(', '\n') + '\n',
  grab('const RX_GG_1015', '/* ================= flow'), grab('const BR=', '/* ================= scenarios'),
  'this.E={isAdj,calc,setA:a=>{A=a}};'].join('\n');
const ctx = {}; vm.createContext(ctx); vm.runInContext(code, ctx); const E = ctx.E;
// 패치된 본체 인라인 스크립트 문법 검사(화면 코드까지 포함)
for (const m of s.matchAll(/<script(?![^>]*src)([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (/type="(application\/ld\+json|module)"/.test(m[1])) continue;
  new vm.Script(m[2]);
}

let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fail++; console.log('FAIL ' + m); } else console.log('ok   ' + m); };
const base = o => Object.assign({ salePrice: 90000, acqPrice: 60000, acqExp: 1500, saleExp: 500, acqDate: { y: 2020, m: 6 }, saleDate: { y: 2026, m: 12 },
  currentlyLiving: false, resMonthsAtSale: 0, resMonthsNow: 0, ptype: 'apartment', offiUse: null, otherCount: 0, memberOtherHouse: false, otherAcq: null,
  address: { region: '서울 마포구' }, acqAdj: false, isResident: true, own: 'single', myShare: 100, members: [], resRatio: 100 }, o);
const run = a => { E.setA(JSON.parse(JSON.stringify(a))); return E.calc(); };
const T = x => Math.round(x.total);

// 기대값은 모두 정부안 기준 수기 계산. 의결안이 다르면 근거와 함께 고친다.
// [R1] 영통 2주택, 양도차익 2.8억(과표 27,750), 중과 시 장특공 배제 유지
const k1 = y => base({ address: { region: '경기 수원시 영통구' }, otherCount: 1, otherAcq: { y: 2018, m: 1 }, saleDate: { y, m: 6 } });
ok(T(run(k1(2026))) === 15511, 'R1 2026 양도 → 현행 +20%p 15,511');
ok(T(run(k1(2027))) === 10932, 'R1 2027 양도 → +5%p (27,750×43%−1,994)×1.1 = 10,932');
ok(T(run(k1(2028))) === 12459, 'R1 2028 양도 → +10%p (27,750×48%−1,994)×1.1 = 12,459');
ok(T(run(k1(2029))) === 15511, 'R1 2029 양도 → 원복 +20%p 15,511');
ok(T(run(Object.assign(k1(2027), { otherCount: 2 }))) === 12459, 'R1 2027 3주택 → +10%p 12,459');
// [R2] 1주택 20억, 2012-03 취득·15년 거주 → 고가 안분 40%, 장특공 80%
const k2 = o => base(Object.assign({ salePrice: 200000, acqPrice: 100000, acqExp: 0, saleExp: 0, acqDate: { y: 2012, m: 3 }, saleDate: { y: 2027, m: 6 }, resMonthsNow: 180, resMonthsAtSale: 180 }, o));
let r = run(k2({})); ok(T(r) === 818 && r.basicDed === 2500, 'R2 2027 10년 거주 1주택 → 기본공제 2,500, (5,500×24%−576)×1.1 = 818');
ok(T(run(k2({ saleDate: { y: 2026, m: 12 } }))) === 1412, 'R2 2026 양도 → 기본공제 250, 1,412');
ok(run(k2({ resMonthsNow: 119, resMonthsAtSale: 119 })).basicDed === 250, 'R2 거주 9년 11개월 → 250');
ok(run(k2({ salePrice: 300001 })).basicDed === 250, 'R2 양도가액 30억 초과 → 250');
ok(run(k2({ own: 'joint', myShare: 50, members: [{ share: 50 }] })).basicDed === 250, 'R2 공동명의 → 원문 확인 전 250 유지');
// [R3] 1주택 고가, 2012-03 취득(보유 15년+)·거주 5년
const k3 = y => base({ salePrice: 200000, acqPrice: 100000, acqExp: 0, saleExp: 0, acqDate: { y: 2012, m: 3 }, saleDate: { y, m: 6 }, resMonthsNow: 60, resMonthsAtSale: 60 });
ok(run(k3(2027)).ltdRate === 60, 'R3 2027 1주택 보유 15·거주 5 → 40+20 = 60%');
ok(run(k3(2028)).ltdRate === 50, 'R3 2028 → 보유 min(20,30)=20 + 거주 min(60,30)=30 = 50%');
ok(run(k3(2029)).ltdRate === 40, 'R3 2029 → 거주 8%×5 = 40%');
// [R3] 비조정 2주택(부산), 2020-06 취득
const k4 = (y, res) => base({ address: { region: '부산 해운대구' }, otherCount: 1, otherAcq: { y: 2018, m: 1 }, saleDate: { y, m: 6 }, resMonthsNow: res, resMonthsAtSale: res });
ok(run(k4(2027, 0)).ltdRate === 14, 'R3 2027 다주택 보유 7년 → 표1 14%');
ok(run(k4(2028, 0)).ltdRate === 8, 'R3 2028 다주택 무거주 보유 8년 → 보유 1%×8 = 8%');
ok(run(k4(2028, 36)).ltdRate === 8, 'R3 2028 다주택 거주 3년 → max(거주 6, 보유 8) = 8%');
ok(run(k4(2029, 0)).ltdRate === 0, 'R3 2029 다주택 무거주 → 0%');
ok(run(k4(2029, 60)).ltdRate === 10, 'R3 2029 다주택 거주 5년 → 2%×5 = 10%');
// [R4] 1주택 50억, 2012-03 취득·15년 거주 → 과세대상 30.4억 × 80% = 24.32억 > 한도
const k5 = y => base({ salePrice: 500000, acqPrice: 100000, acqExp: 0, saleExp: 0, acqDate: { y: 2012, m: 3 }, saleDate: { y, m: 6 }, resMonthsNow: 180, resMonthsAtSale: 180 });
ok(Math.round(run(k5(2027)).ltdAmt) === 243200, 'R4 2027 한도 없음 → 243,200만');
ok(run(k5(2028)).ltdAmt === 200000, 'R4 2028 한도 20억');
ok(run(k5(2029)).ltdAmt === 100000, 'R4 2029 한도 10억');
// 회귀: 2026 양도분은 패치 전과 같아야 한다 → calc-law-test.cjs를 --write 후 반드시 돌린다

console.log((fail ? 'FAIL ' + fail : 'ALL PASS') + ' ' + n + ' tests (정부안 기준)');
if (fail) process.exit(1);

if (process.argv.includes('--write')) {
  patched.forEach((p, i) => { if (p !== parts[i]) fs.writeFileSync(path.join(dir, files[i]), p); });
  const sha = crypto.createHash('sha256').update(patched.join('')).digest('hex');
  fs.writeFileSync(path.join(dir, 'index.sha256'), sha);
  console.log('WROTE _parts (' + files.filter((f, i) => patched[i] !== parts[i]).join(', ') + '), index.sha256 = ' + sha);
}
