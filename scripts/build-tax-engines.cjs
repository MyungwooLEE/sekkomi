#!/usr/bin/env node
/* 세금 엔진 공개 번들 빌드 — scripts/build-tax-engines.cjs (2026-11-25 신설)
   증여세 계산기 페이지(/jeungyeose-gyesangi)가 쓰는 두 엔진을 public/ 으로 만든다.
   ★ 운영 기준 §17: 「엔진 숫자를 페이지에 손으로 다시 쓰지 않는다. 엔진 파일을 그대로 싣거나
     빌드가 복사하고, 복사본이면 sha 대조 assert를 건다.」 이 파일이 그 집행 지점이다.

   1) public/gift-engine.js  <- tools/tax/gift-engine.cjs 를 바이트 그대로 복사
      (UMD 라 브라우저에서는 globalThis.SekkomiGift 가 된다. 한 글자도 고치지 않는다.)
   2) public/yangdo-engine.js <- _parts/index.html.part* 를 조립해 양도 엔진 구간을 떼어 낸다.
      떼어 내는 표식은 tools/tax/calc-law-test.cjs·gift-law-test.cjs 와 동일하다.
      표식이 바뀌면 [C0] 회귀 테스트가 marker not found 로 먼저 멈춘다(운영 기준 §16.2).

   sha 대조 assert = 「쓴 파일이 원본과 바이트 동일한가」다. 전사 손상을 막는 것이 목적이고,
   특정 버전을 고정하는 핀이 아니다(엔진을 고치면 테스트가 먼저 잡는다 — §16.3).
   assert 가 깨지면 exit 1 → 빌드가 실패하고 기존 배포가 유지된다. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const out = [];
let failed = 0;
function assert(cond, msg) { out.push((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; }

/* ---------- 1) 증여세 엔진: 바이트 그대로 복사 ---------- */
const giftSrcPath = path.join(root, 'tools', 'tax', 'gift-engine.cjs');
const giftBuf = fs.readFileSync(giftSrcPath);
const giftDst = path.join(root, 'public', 'gift-engine.js');
fs.writeFileSync(giftDst, giftBuf);
const giftBack = fs.readFileSync(giftDst);
assert(sha(giftBack) === sha(giftBuf), 'gift-engine 복사본 sha256 == 원본 (' + giftBuf.length + '바이트, ' + sha(giftBuf).slice(0, 16) + '…)');
assert(giftBack.length === giftBuf.length, 'gift-engine 길이 일치 ' + giftBack.length);
assert(giftBuf.toString('utf8').indexOf('root.SekkomiGift=api') > 0, 'gift-engine 브라우저 전역 노출 구문 존재');

/* ---------- 2) 양도 엔진: _parts 에서 구간 추출 ---------- */
const pdir = path.join(root, '_parts');
const parts = fs.readdirSync(pdir).filter(f => /^index\.html\.part\d+$/.test(f)).sort();
const s = parts.map(f => fs.readFileSync(path.join(pdir, f), 'utf8')).join('');
function grab(start, end) {
  const i = s.indexOf(start);
  if (i < 0) { console.error('marker not found: ' + start); process.exit(1); }
  const j = s.indexOf(end, i);
  if (j < 0) { console.error('end marker not found: ' + end); process.exit(1); }
  return s.slice(i, j);
}
const slices = [
  grab('const ymNum=', 'function fmtMan('),
  grab('function addMonths(', '\n') + '\n',
  grab('const RX_GG_1015', '/* ================= flow'),
  grab('const BR=', '/* ================= scenarios')
];
slices.forEach((sl, k) => {
  assert(s.indexOf(sl) >= 0, '양도 엔진 구간 ' + (k + 1) + ' 이 조립본에 바이트 그대로 존재 (' + sl.length + '자, ' + sha(sl).slice(0, 16) + '…)');
});
const yangdo = [
  '/* 세꼼이 양도세 엔진 — 빌드 산출물. 원본은 _parts/index.html.part* 다. 이 파일을 직접 고치지 않는다.',
  '   scripts/build-tax-engines.cjs 가 매 빌드마다 다시 만든다(운영 기준 §17). */',
  '(function(root){',
  'let A={};',
  'var _n=new Date();const NOWY=_n.getFullYear(),NOWM=_n.getMonth()+1;',
  slices.join('\n'),
  'root.SekkomiYangdo={calc:calc,setA:function(a){A=a},isAdj:isAdj,adjHistoryUnknown:adjHistoryUnknown,temp2Months:temp2Months,LAW_ASOF:LAW_ASOF};',
  '})(typeof globalThis!=="undefined"?globalThis:this);',
  ''
].join('\n');
const yangdoDst = path.join(root, 'public', 'yangdo-engine.js');
fs.writeFileSync(yangdoDst, yangdo, 'utf8');
const yBack = fs.readFileSync(yangdoDst, 'utf8');
assert(yBack === yangdo, 'yangdo-engine 기록 내용 == 생성 내용 (' + Buffer.byteLength(yangdo) + '바이트, ' + sha(yangdo).slice(0, 16) + '…)');
slices.forEach((sl, k) => assert(yBack.indexOf(sl) >= 0, 'yangdo-engine 산출물에 구간 ' + (k + 1) + ' 바이트 그대로 포함'));
const FFFD = String.fromCharCode(0xFFFD); /* 대체문자. 이스케이프 표기도 리터럴도 쓰지 않는다 — 전송 계층이 둘 다 바꿔 놓는다(11/25 실측) */
assert(yBack.indexOf(FFFD) < 0, 'yangdo-engine U+FFFD 0건');
assert(giftBuf.toString('utf8').indexOf(FFFD) < 0, 'gift-engine U+FFFD 0건');

/* ---------- 3) 산출물이 실제로 돌아가는지 ---------- */
try {
  const vm = require('vm'), ctx = {};
  vm.createContext(ctx);
  vm.runInContext(yBack, ctx);
  assert(typeof ctx.SekkomiYangdo === 'object' && typeof ctx.SekkomiYangdo.calc === 'function', 'yangdo-engine 로드 후 calc 함수 존재');
  assert(ctx.SekkomiYangdo.isAdj('서울 강남구', 2026, 11) === true, 'yangdo-engine isAdj 동작 확인 (서울 강남구 2026-11 = 조정)');
  const gctx = {};
  vm.createContext(gctx);
  vm.runInContext(giftBack.toString('utf8'), gctx);
  const G = gctx.SekkomiGift;
  assert(G && typeof G.giftTax === 'function', 'gift-engine 로드 후 giftTax 함수 존재');
  assert(typeof G.ASOF === 'string' && G.ASOF.length > 0, 'gift-engine ASOF 노출 ' + (G && G.ASOF));
  assert(typeof ctx.SekkomiYangdo.LAW_ASOF === 'string', 'yangdo-engine LAW_ASOF 노출 ' + ctx.SekkomiYangdo.LAW_ASOF);
  assert(Math.abs(G.giftTax({ rel: 'ascendant', value: 10000 }).giftTax - 485) < 0.01, 'gift-engine T1 485만 재현 (부모→성년 자녀 1억)');
} catch (e) {
  assert(false, '산출물 로드 상태 예외: ' + e.message);
}

console.log('[build-tax-engines] ' + out.join('\n[build-tax-engines] '));
if (failed) { console.error('[build-tax-engines] ' + failed + ' assert 실패 — 빌드를 중단한다'); process.exit(1); }
console.log('[build-tax-engines] ALL PASS ' + out.length + ' asserts');
