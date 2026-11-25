#!/usr/bin/env node
/* public/ 옮겨 적기(전사) 오류 가드 — scripts/verify-public-sha.cjs (2026-11-25 신설)

   왜: 레포 쓰기는 GitHub MCP push_files 하나뿐이라 파일 본문을 손으로 옮겨 적는다.
   2026-11-24·25에 한글이 다른 글자로 바뀌는 일이 여러 번 있었고, 11/25에는 빌라 글 오타 3글자가
   그대로 배포됐다. 계산기(_parts)에는 체크섬 가드가 있었지만 public/ 에는 없었다.

   어떻게: 이번 배포 범위(CACHED_COMMIT_REF..COMMIT_REF)에서 바뀐 public/ 텍스트 파일은
   전부 _parts/public-changes.sha256 에 「로컬 검증본의」 sha256 이 적혀 있어야 하고, 적힌 값이
   레포 파일과 같아야 한다. 하나라도 틀리면 exit 1 → 빌드 실패 → 기존 배포가 유지된다.

   쓰는 법 (push 하기 전, 로컬 검증본이 있는 작업 디렉터리에서):
     node scripts/verify-public-sha.cjs --reset public/blog/a.html public/sitemap-blog.xml
       → 이번 배포 묶음의 첫 커밋. 목록을 새로 쓴다.
     node scripts/verify-public-sha.cjs --add public/blog/b.html
       → 같은 배포 묶음(스킵 토큰 커밋 → 마지막 배포 커밋)의 다음 커밋. 줄을 더하거나 고친다.
     node scripts/verify-public-sha.cjs --check
       → 빌드가 하는 검사. push 전에 로컬에서도 돌린다(CACHED_COMMIT_REF 를 지정하면 범위 검사까지).
   ★ 목록은 반드시 push 전 로컬 검증본으로 만든다. push 후 새 클론에서 만들면 깨진 글자를 그대로
     「정상」으로 등록하게 되어 가드가 무의미해진다.
   ★ 바뀐 파일과 _parts/public-changes.sha256 을 같은 push_files 호출(같은 커밋)에 넣는다.

   범위: public/ 아래 텍스트 파일(html·xml·txt·js·css·json·md·webmanifest·svg).
   제외: public/reels/ (render-reel 워크플로 봇이 커밋한다 — 사람 손으로 옮겨 적지 않음).
   CACHED_COMMIT_REF 가 없거나 git diff 가 실패하면 범위 검사를 건너뛰고(경고 출력) 목록에 적힌
   줄만 검사한다. */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const root = path.resolve(__dirname, '..');
const MAN = path.join(root, '_parts', 'public-changes.sha256');
const TEXT = /\.(html|xml|txt|js|css|json|md|webmanifest|svg)$/i;
const EXCLUDE = [/^public\/reels\//];
const inScope = f => f.startsWith('public/') && TEXT.test(f) && !EXCLUDE.some(r => r.test(f));
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex');
const log = m => console.log('[verify-public-sha] ' + m);

function readMan() {
  const m = new Map();
  if (!fs.existsSync(MAN)) return m;
  fs.readFileSync(MAN, 'utf8').split('\n').forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const mm = t.match(/^([0-9a-f]{64}) {2}(\S+)$/);
    if (!mm) { log('FAIL 목록 ' + (i + 1) + '번째 줄 형식이 틀림: ' + JSON.stringify(t)); process.exit(1); }
    m.set(mm[2], mm[1]);
  });
  return m;
}
function writeMan(m) {
  const lines = [...m.keys()].sort().map(f => m.get(f) + '  ' + f);
  fs.writeFileSync(MAN, lines.join('\n') + (lines.length ? '\n' : ''));
  log('wrote ' + path.relative(root, MAN) + ' (' + lines.length + ' files)');
  lines.forEach(l => console.log('  ' + l));
}

const mode = process.argv[2] || '--check';
if (mode === '--reset' || mode === '--add') {
  const files = process.argv.slice(3);
  if (!files.length) { log('파일을 하나 이상 지정하세요'); process.exit(2); }
  const m = mode === '--reset' ? new Map() : readMan();
  for (const f of files) {
    if (!inScope(f)) { log('범위 밖 파일: ' + f); process.exit(2); }
    if (!fs.existsSync(path.join(root, f))) { log('파일 없음: ' + f); process.exit(2); }
    m.set(f, sha(f));
  }
  writeMan(m);
  process.exit(0);
}
if (mode !== '--check') { log('알 수 없는 옵션: ' + mode); process.exit(2); }

const man = readMan();
let fail = 0;
for (const [f, h] of man) {
  if (!fs.existsSync(path.join(root, f))) { log('FAIL 목록에 있는데 파일이 없음: ' + f); fail++; continue; }
  const got = sha(f);
  if (got !== h) { log('FAIL sha 불일치 ' + f + '\n    목록 ' + h + '\n    레포 ' + got); fail++; }
  else log('ok   ' + f);
}
const a = process.env.CACHED_COMMIT_REF, b = process.env.COMMIT_REF || 'HEAD';
if (!a || a === b) log('WARN 배포 범위 없음(CACHED_COMMIT_REF=' + a + ') — 범위 검사 생략, 목록 줄만 검사');
else {
  let changed = null;
  try {
    changed = cp.execSync('git diff --name-only --diff-filter=AMR ' + a + ' ' + b + ' -- public',
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map(s => s.trim()).filter(Boolean).filter(inScope);
  } catch (e) { log('WARN git diff 실패 — 범위 검사 생략, 목록 줄만 검사: ' + (e && e.message)); }
  if (changed) {
    log('배포 범위 ' + a.slice(0, 7) + '..' + String(b).slice(0, 7) + ' 에서 바뀐 public 텍스트 파일 ' + changed.length + '개');
    for (const f of changed) if (!man.has(f)) { log('FAIL 바뀌었는데 목록에 없음: ' + f); fail++; }
  }
}
if (fail) { log('FAIL ' + fail + '건 — 배포를 멈춘다(기존 배포 유지). 로컬 검증본과 레포 파일을 cmp 로 대조하라.'); process.exit(1); }
log('ALL PASS (' + man.size + ' listed)');
