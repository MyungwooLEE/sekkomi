#!/usr/bin/env node
/* 세꼼이 보고 본문 검사기 — tools/report/check-report-body.cjs (2026-11-27 신설)

   용도: 데일리/주간 보고 본문과 실행 기록을 Resend 로 보내거나 project_write 하기 전에
         돌린다. 운영 기준 §10 「본문을 먼저 파일로 쓰고 스크립트로 검사한 뒤 보낸다」를
         코드로 내린 자리다.

   왜 레포에 두는가: 운영 기준 §0 — 「코드로 내려가지 않은 등재는 한 세션짜리다.」
   이 검사는 2026-11-24·11-25·11-27 세 세션이 각자 다시 썼고 매번 같은 오탐을 다시 겪었다.
   §15 「조립·검증 스크립트가 레포에 없다」의 보고 검사 쪽 첫 집행이다.
   tools/ 아래는 Netlify 빌드를 돌리지 않는다(운영 기준 §8).

   사용: node tools/report/check-report-body.cjs <파일경로> [...]
   종료코드: 0 = 통과, 1 = 위반, 2 = 사용법 오류

   ───────────────────────────────────────────────────────────────────────────
   ★ 핵심 규칙 (운영 기준 §7·§10) — 「문서가 자기 검사 규칙을 인용하면 그 검사는
     절대값으로 걸 수 없다.」 그래서 검사를 두 부류로 가른다.

   (가) 절대값으로 걸 수 있는 것: 그 문서가 인용하지 않는 토큰.
        대체문자(U+FFFD) · 한글 음절 사이에 끼어든 라틴 문자.

   (나) 정의를 좁혀야 하는 것: 「빈 숫자 자리」.
        실측된 오탐 세 부류가 있다 —
          1. 2026-11-25: 「채널(...):」 머리말 콜론을 구멍으로 잡았다.
          2. 2026-11-27: 등호로 끝나는 구분선(=====)을 콜론/등호 규칙이 잡았다. 8건.
          3. 2026-11-27: 값이 다음 줄에 있는 머리말 콜론. 6건. (1번의 일반형)
        → 정의: 「구멍」 = 줄 끝이 콜론 또는 등호인데 (가) 그 줄이 구분선이 아니고
                 (나) 뒤따르는 비어있지 않은 줄이 값을 공급하지 않는 경우.
        분모(줄 끝이 콜론/등호인 줄 전체)와 제외 내역을 항상 함께 출력한다 —
        운영 기준 §7 「개수 assert 는 그 개수가 무엇을 세는지 정의와 함께 적는다」.

   ★ 자리표시 토큰(PLACEHOLDER·TODO·LOREM·TBD·@@·FIXME)은 절대값 검사 대상이지만,
     이 스크립트 자신이 그 토큰을 인용하고 있다. 그래서 검사 대상 파일에만 적용하고
     이 파일을 자기 자신에게 통과시키려 하지 않는다. 보고 본문이 그 토큰을 인용하면
     --quote=TOKEN,TOKEN 으로 인용 위치 수를 넘겨 그 개수만큼 허용한다.
   ─────────────────────────────────────────────────────────────────────────── */

'use strict';
const fs = require('fs');

const REPLACEMENT = String.fromCharCode(0xFFFD); // 리터럴로 쓰지 않는다(운영 기준 §8)
const PLACEHOLDER_TOKENS = ['PLACE' + 'HOLDER', 'TO' + 'DO', 'LO' + 'REM', 'TB' + 'D', '@' + '@', 'FIX' + 'ME'];

function isDivider(line) {
  const t = line.trim();
  if (t.length < 4) return false;
  return /^[=\-_*~#]+$/.test(t);
}

function nextNonEmpty(lines, i) {
  for (let j = i + 1; j < lines.length; j++) if (lines[j].trim()) return lines[j];
  return null;
}

function checkFile(path, allowed) {
  const src = fs.readFileSync(path, 'utf8');
  const lines = src.split('\n');
  const fails = [];
  console.log(`\n=== ${path} ===`);
  console.log(`문자 ${src.length} · 바이트 ${Buffer.byteLength(src, 'utf8')} · 줄 ${lines.length}`);

  // (가) 절대값 — 대체문자
  const rep = src.split(REPLACEMENT).length - 1;
  console.log(`[1] 대체문자(U+FFFD): ${rep}건`);
  if (rep > 0) fails.push(`U+FFFD ${rep}건`);

  // (가) 절대값 — 한글 음절 사이 라틴 문자 (전사 손상 패턴)
  const wedge = src.match(/[가-힣][A-Za-z][가-힣]/g) || [];
  console.log(`[2] 한글-라틴-한글 끼임: ${wedge.length}건${wedge.length ? '  ' + wedge.slice(0, 8).join(' ') : ''}`);
  if (wedge.length > 0) fails.push(`한글 중간 라틴 ${wedge.length}건`);

  // (가) 절대값 — 자리표시 토큰 (인용분은 --quote 로 허용)
  console.log('[3] 자리표시 토큰 (허용치는 --quote 로 지정)');
  for (const tok of PLACEHOLDER_TOKENS) {
    const n = src.split(tok).length - 1;
    const ok = allowed[tok] || 0;
    const mark = n > ok ? `  <-- 위반 (허용 ${ok})` : '';
    if (n || ok) console.log(`      ${tok}: ${n}건${mark}`);
    if (n > ok) fails.push(`${tok} ${n}건 (허용 ${ok})`);
  }

  // (나) 정의를 좁힌 검사 — 빈 숫자 자리
  const cand = [], divs = [], heads = [], holes = [];
  lines.forEach((line, i) => {
    if (!/[:=]\s*$/.test(line)) return;
    cand.push(i + 1);
    if (isDivider(line)) { divs.push(i + 1); return; }
    if (nextNonEmpty(lines, i) !== null) { heads.push([i + 1, line.trim().slice(0, 50)]); return; }
    holes.push([i + 1, line.trim().slice(0, 60)]);
  });
  console.log('[4] 빈 숫자 자리');
  console.log('      개수 정의: 줄 끝이 콜론/등호인데 (가) 구분선이 아니고 (나) 뒤따르는');
  console.log('                 비어있지 않은 줄이 값을 공급하지 않는 경우.');
  console.log(`      줄 끝이 콜론/등호인 줄 전체 : ${cand.length}`);
  console.log(`        그중 구분선(값 아님)       : ${divs.length}`);
  console.log(`        그중 머리말(다음 줄이 값)  : ${heads.length}`);
  console.log(`        실제 구멍                  : ${holes.length}`);
  for (const h of holes) console.log(`            ${h[0]}  ${h[1]}`);
  if (holes.length > 0) fails.push(`빈 숫자 자리 ${holes.length}건`);

  // 참고 수치 — 보고에 그대로 쓸 수 있게 print 한다(운영 기준 §7)
  const hangul = (src.match(/[가-힣]/g) || []).length;
  const urls = src.match(/https?:\/\/[^\s)\]]+/g) || [];
  console.log(`[5] 참고: 한글 음절 ${hangul} · URL ${urls.length}(고유 ${new Set(urls).size}) · 읽는 시간 환산 ${(hangul / 600).toFixed(1)}분`);

  return fails;
}

function main() {
  const args = process.argv.slice(2);
  const allowed = {};
  const paths = [];
  for (const a of args) {
    if (a.startsWith('--quote=')) {
      for (const t of a.slice(8).split(',')) if (t) allowed[t.trim()] = (allowed[t.trim()] || 0) + 1;
    } else paths.push(a);
  }
  if (paths.length === 0) {
    console.error('사용: node tools/report/check-report-body.cjs <파일경로> [...] [--quote=TOKEN,TOKEN]');
    process.exit(2);
  }
  let all = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) { console.error(`파일 없음: ${p}`); all.push(`${p} 파일 없음`); continue; }
    all = all.concat(checkFile(p, allowed).map((f) => `${p}: ${f}`));
  }
  console.log('');
  if (all.length === 0) { console.log(`ALL PASS ${paths.length} files`); process.exit(0); }
  console.log(`FAIL ${all.length} / ${paths.length} files`);
  for (const f of all) console.log('  ' + f);
  process.exit(1);
}

main();
