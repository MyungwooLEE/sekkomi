#!/usr/bin/env node
/**
 * 렌더가 끝난 릴스를 게시 큐(public/reels/queue.json)에 등록한다.
 * GitHub Actions(.github/workflows/render-reel.yml)가 렌더 직후 호출한다.
 *
 *   node scripts/reel-queue-add.cjs <id> [<id> ...]
 *
 * 큐는 append-only 매니페스트다. 게시 완료 여부는 이 파일이 아니라 Netlify Blobs에
 * 기록된다(함수가 레포에 쓸 수 없으므로). 따라서 여기서 항목을 지우거나 상태를 바꾸지 않는다.
 *
 * publish_after 기본값 = 커밋 시점의 KST 당일 19:00.
 * 함수 스케줄 자체가 KST 19~22시 창이므로, 아침에 렌더돼도 저녁 창에서 나간다.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const QUEUE = path.join('public', 'reels', 'queue.json');
const JOBS = path.join('tools', 'shortform', 'queue');

/** 오늘(KST) 19:00을 UTC ISO로 */
function todayKst1900() {
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const y = kstNow.getUTCFullYear();
  const m = kstNow.getUTCMonth();
  const d = kstNow.getUTCDate();
  // KST 19:00 == UTC 10:00 같은 날
  return new Date(Date.UTC(y, m, d, 10, 0, 0)).toISOString();
}

const ids = process.argv.slice(2).filter(Boolean);
if (!ids.length) {
  console.log('등록할 id 없음');
  process.exit(0);
}

let queue = { items: [] };
if (fs.existsSync(QUEUE)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
    if (Array.isArray(parsed?.items)) queue = parsed;
  } catch (e) {
    // 큐가 깨졌으면 덮어쓰지 않고 멈춘다. 조용히 날리면 게시 이력을 잃는다.
    console.error(`queue.json 파싱 실패 — 중단합니다: ${e.message}`);
    process.exit(1);
  }
}

let added = 0;
for (const id of ids) {
  if (queue.items.some((it) => it.id === id)) {
    console.log(`${id}: 이미 큐에 있음`);
    continue;
  }

  const jobPath = path.join(JOBS, `${id}.json`);
  if (!fs.existsSync(jobPath)) {
    console.error(`${id}: 작업 메타(${jobPath})가 없어 건너뜀`);
    continue;
  }
  const meta = JSON.parse(fs.readFileSync(jobPath, 'utf8'));

  if (!meta.caption || !String(meta.caption).trim()) {
    // 캡션 없는 게시는 사고다. 등록하지 않는다.
    console.error(`${id}: caption이 비어 있어 등록하지 않음`);
    continue;
  }

  const coverPath = path.join('public', 'reels', `${id}_cover.jpg`);
  queue.items.push({
    id,
    video: `/reels/${id}.mp4`,
    cover: fs.existsSync(coverPath) ? `/reels/${id}_cover.jpg` : undefined,
    caption: meta.caption,
    blog_url: meta.blog_url || undefined,
    publish_after: meta.publish_after || todayKst1900(),
    queued_at: new Date().toISOString(),
  });
  added++;
  console.log(`${id}: 큐 등록 (publish_after=${meta.publish_after || todayKst1900()})`);
}

if (added) {
  fs.mkdirSync(path.dirname(QUEUE), { recursive: true });
  fs.writeFileSync(QUEUE, JSON.stringify(queue, null, 2) + '\n');
  console.log(`queue.json 갱신 — 총 ${queue.items.length}건`);
}

// 글 전용 OG 카드(1200x630) 생성 — 구글 디스커버/SNS 공유용.
// 워크플로가 public/reels 디렉터리를 통째로 커밋하므로 여기서 만들면 함께 커밋된다.
// 부가 산출물이라 실패해도 절대 종료 코드에 영향을 주지 않는다.
try {
  const og = path.join('tools', 'shortform', 'og_render.py');
  if (fs.existsSync(og)) {
    const r = spawnSync('python3', [og, ...ids], { stdio: 'inherit' });
    if (r.status !== 0) console.log('og_render 비정상 종료 — 무시하고 계속');
  }
} catch (e) {
  console.log(`og_render 호출 실패 — 무시하고 계속: ${e.message}`);
}
