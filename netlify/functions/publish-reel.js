/**
 * 세꼼(Sekkomi) 인스타 릴스 자동 게시 — Netlify Scheduled Function
 * ────────────────────────────────────────────────────────────────
 * 왜 함수인가: 액세스 토큰이 자동화 세션이나 공개 레포에 절대 노출되지 않게 하려고.
 * 토큰은 Netlify 환경변수로 최초 1회만 주입되고, 이후 Blobs에 보관되며 스스로 갱신된다.
 *
 * 동작
 *   1) 토큰 유지: 하루 1회 refresh_access_token 호출(장기 토큰 60일 → 갱신 시점부터 다시 60일).
 *      이 함수가 매일 도니까 토큰은 사실상 영구히 살아 있다. 갱신을 놓치면 60일 뒤 게시가 죽는다.
 *   2) 큐 확인: public/reels/queue.json 에서 publish_after 가 지난 미게시 항목 1건을 고른다.
 *   3) 2단계 발행(IG 규격): 컨테이너 생성 → status_code 폴링 → media_publish.
 *      Scheduled Function 은 실행 30초 제한이라 한 번에 다 하지 않고 **상태 머신**으로 쪼갠다.
 *      (pending → container → published). 5분마다 깨어나 한 단계씩 진행.
 *
 * 스케줄: UTC 10:00~13:59 매 5분 = KST 19:00~22:59.
 *   숏폼 제작 기준의 "평일 19~22시 게시 권장" 창과 일치시킨 것. 창 밖에는 아예 안 깨어난다.
 *
 * 하루 최대 1건만 게시한다. 밀린 큐가 한꺼번에 쏟아지면 계정 신뢰도에 해롭다.
 *
 * 필요한 환경변수 (Netlify UI에서 설정, Secret 권장)
 *   IG_ACCESS_TOKEN  최초 부트스트랩용 장기 토큰. Blobs에 옮겨진 뒤로는 안 읽는다.
 *   IG_USER_ID       (선택) 없으면 /me 로 조회해 Blobs에 캐시.
 *   IG_API_VERSION   (선택) 기본 v23.0
 *   IG_PUBLISH_ENABLED  "1" 이어야 실제 게시. 미설정이면 드라이런(로그만).
 */
import { getStore } from "@netlify/blobs";

const HOST = "https://graph.instagram.com";
const STORE = "seggom-reels";
const QUEUE_URL = "/reels/queue.json";
const MAX_ATTEMPTS = 6;          // 한 항목당 총 시도 횟수(5분 간격 → 약 30분)
const TOKEN_REFRESH_EVERY_MS = 24 * 60 * 60 * 1000;
const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;   // 예정 시각에서 3일 지난 항목은 폐기

const ver = () => Netlify.env.get("IG_API_VERSION") || "v23.0";
const enabled = () => Netlify.env.get("IG_PUBLISH_ENABLED") === "1";
const siteUrl = () => (Netlify.env.get("SITE_URL") || "https://sekkomi.com").replace(/\/$/, "");

/** 토큰은 절대 로그에 남기지 않는다. 오류 메시지에 섞여 나올 수 있어 마스킹한다. */
const scrub = (s, token) => {
  let out = String(s ?? "");
  if (token) out = out.split(token).join("***");
  return out.replace(/(access_token=)[^&\s"]+/gi, "$1***");
};

async function api(path, { method = "GET", params = {}, token } = {}) {
  const url = new URL(HOST + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  url.searchParams.set("access_token", token);
  const res = await fetch(url, { method });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok || body?.error) {
    const msg = body?.error?.message || body?.raw || `HTTP ${res.status}`;
    throw new Error(`${path.split("?")[0]} → ${scrub(msg, token)}`);
  }
  return body;
}

/** 환경변수 → Blobs 1회 이관 후, 이후로는 Blobs 토큰만 사용·갱신한다. */
async function getToken(store) {
  let rec = null;
  try { rec = JSON.parse((await store.get("token")) || "null"); } catch {}
  if (!rec?.access_token) {
    const seed = Netlify.env.get("IG_ACCESS_TOKEN");
    if (!seed) throw new Error("IG_ACCESS_TOKEN 미설정 — 최초 토큰을 Netlify 환경변수에 넣어주세요");
    rec = { access_token: seed, refreshed_at: 0, seeded_at: Date.now() };
    await store.set("token", JSON.stringify(rec));
  }
  return rec;
}

/** 24시간에 한 번만 갱신. 토큰은 최소 24시간 경과해야 갱신 가능하다(IG 규격). */
async function maybeRefreshToken(store, rec, log) {
  const age = Date.now() - (rec.refreshed_at || rec.seeded_at || 0);
  if (age < TOKEN_REFRESH_EVERY_MS) return rec;
  try {
    const r = await api("/refresh_access_token", {
      params: { grant_type: "ig_refresh_token" },
      token: rec.access_token,
    });
    if (r?.access_token) {
      rec = {
        access_token: r.access_token,
        refreshed_at: Date.now(),
        expires_in: r.expires_in ?? null,
      };
      await store.set("token", JSON.stringify(rec));
      log.push(`token refreshed (expires_in=${r.expires_in ?? "?"}s)`);
    }
  } catch (e) {
    // 갱신 실패는 치명적이다 — 방치하면 60일 뒤 조용히 죽는다.
    log.push(`TOKEN REFRESH FAILED: ${e.message}`);
    await notify(store, "인스타 토큰 갱신 실패", e.message);
  }
  return rec;
}

async function getUserId(store, token) {
  const fromEnv = Netlify.env.get("IG_USER_ID");
  if (fromEnv) return fromEnv;
  const cached = await store.get("user_id");
  if (cached) return cached;
  const me = await api(`/${ver()}/me`, { params: { fields: "user_id,username" }, token });
  const id = me.user_id || me.id;
  if (!id) throw new Error("IG user_id 조회 실패");
  await store.set("user_id", String(id));
  return String(id);
}

/** 실패는 조용히 넘어가면 안 된다. 오너에게 메일로 알린다. */
async function notify(store, subject, detail) {
  const key = Netlify.env.get("RESEND_API_KEY");
  const to = Netlify.env.get("ADMIN_EMAIL");
  if (!key || !to) return;
  // 같은 사유로 하루에 여러 번 보내지 않는다.
  const dedupeKey = "notified-" + subject.replace(/\s+/g, "-");
  const last = Number((await store.get(dedupeKey)) || 0);
  if (Date.now() - last < TOKEN_REFRESH_EVERY_MS) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Netlify.env.get("MAIL_FROM") || "세꼼이 <noreply@sekkomi.com>",
        to: [to],
        subject: `[세꼼이 릴스] ${subject}`,
        text: `${detail}\n\n— 인스타 자동 게시 함수(publish-reel)`,
      }),
    });
    await store.set(dedupeKey, String(Date.now()));
  } catch {}
}

async function loadQueue() {
  const res = await fetch(siteUrl() + QUEUE_URL, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`queue.json 로드 실패 (HTTP ${res.status})`);
  const q = await res.json();
  return Array.isArray(q?.items) ? q.items : [];
}

const stateKey = (id) => `state-${id}`;
const readState = async (store, id) => {
  try { return JSON.parse((await store.get(stateKey(id))) || "null") || {}; } catch { return {}; }
};
const writeState = (store, id, s) =>
  store.set(stateKey(id), JSON.stringify({ ...s, updated_at: new Date().toISOString() }));

/** 오늘(KST) 이미 한 건 게시했는지 */
function kstDay(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export default async () => {
  const log = [];
  const store = getStore(STORE);

  try {
    let tok = await getToken(store);
    tok = await maybeRefreshToken(store, tok, log);
    const token = tok.access_token;

    const items = await loadQueue();
    const now = Date.now();

    // 이미 진행 중인 항목이 있으면 그것부터 끝낸다. 없으면 새로 시작할 항목을 고른다.
    let target = null;
    let state = null;
    for (const it of items) {
      const s = await readState(store, it.id);
      if (s.status === "container") { target = it; state = s; break; }
    }

    if (!target) {
      const lastDay = await store.get("last_published_day");
      if (lastDay === kstDay()) {
        log.push("오늘 이미 1건 게시함 — 대기");
        return void console.log(log.join(" | "));
      }
      for (const it of items) {
        const s = await readState(store, it.id);
        if (s.status === "published" || s.status === "failed") continue;
        const after = it.publish_after ? Date.parse(it.publish_after) : 0;
        if (Number.isFinite(after) && after > now) continue;
        // 묵은 항목은 내보내지 않는다. 게시가 며칠 멈춰 있었다면(설정 지연·오류) 큐가 쌓이는데,
        // 그걸 하루 1건씩 흘려보내면 철 지난 뉴스 릴스가 뒤늦게 나간다.
        if (after && now - after > STALE_AFTER_MS) {
          await writeState(store, it.id, { ...s, status: "failed", error: "기한 경과(stale)" });
          log.push(`${it.id}: 기한 경과로 건너뜀`);
          continue;
        }
        target = it; state = s; break;
      }
    }

    if (!target) {
      log.push("게시할 항목 없음");
      return void console.log(log.join(" | "));
    }

    const attempts = (state.attempts || 0) + 1;
    if (attempts > MAX_ATTEMPTS) {
      await writeState(store, target.id, { ...state, status: "failed", error: "시도 횟수 초과" });
      await notify(store, `게시 실패: ${target.id}`, `시도 ${MAX_ATTEMPTS}회를 넘겨 중단했습니다.\n마지막 오류: ${state.error || "-"}`);
      log.push(`${target.id}: 시도 초과로 실패 처리`);
      return void console.log(log.join(" | "));
    }

    const videoUrl = target.video?.startsWith("http") ? target.video : siteUrl() + target.video;
    const coverUrl = target.cover
      ? (target.cover.startsWith("http") ? target.cover : siteUrl() + target.cover)
      : undefined;

    if (!enabled()) {
      log.push(`DRY RUN (IG_PUBLISH_ENABLED≠1): ${target.id} ← ${videoUrl}`);
      return void console.log(log.join(" | "));
    }

    const userId = await getUserId(store, token);

    // ── 1단계: 컨테이너 생성 ────────────────────────────────
    if (state.status !== "container") {
      // 배포 직후엔 영상 URL이 아직 안 붙을 수 있다. Meta가 가져가야 하므로 먼저 확인한다.
      const head = await fetch(videoUrl, { method: "HEAD" });
      if (!head.ok) {
        await writeState(store, target.id, { ...state, attempts, error: `영상 URL 미준비 (HTTP ${head.status})` });
        log.push(`${target.id}: 영상 URL 아직 200 아님 — 다음 주기 재시도`);
        return void console.log(log.join(" | "));
      }

      const created = await api(`/${ver()}/${userId}/media`, {
        method: "POST",
        params: {
          media_type: "REELS",
          video_url: videoUrl,
          caption: target.caption || "",
          cover_url: coverUrl,
          share_to_feed: target.share_to_feed === false ? "false" : "true",
        },
        token,
      });
      await writeState(store, target.id, {
        status: "container", container_id: created.id, attempts, error: null,
      });
      log.push(`${target.id}: 컨테이너 생성 ${created.id}`);
      return void console.log(log.join(" | "));
    }

    // ── 2단계: 상태 확인 후 게시 ────────────────────────────
    const st = await api(`/${ver()}/${state.container_id}`, {
      params: { fields: "status_code,status" }, token,
    });
    const code = st.status_code;
    log.push(`${target.id}: container=${code}`);

    if (code === "IN_PROGRESS") {
      await writeState(store, target.id, { ...state, attempts });
      return void console.log(log.join(" | "));
    }
    if (code === "ERROR" || code === "EXPIRED") {
      await writeState(store, target.id, { ...state, status: "failed", attempts, error: `${code}: ${st.status || ""}` });
      await notify(store, `게시 실패: ${target.id}`, `컨테이너 상태 ${code}\n${st.status || ""}`);
      return void console.log(log.join(" | "));
    }
    if (code === "PUBLISHED") {
      await writeState(store, target.id, { ...state, status: "published", attempts });
      await store.set("last_published_day", kstDay());
      return void console.log(log.join(" | "));
    }

    // FINISHED → 발행
    const pub = await api(`/${ver()}/${userId}/media_publish`, {
      method: "POST", params: { creation_id: state.container_id }, token,
    });
    await writeState(store, target.id, {
      ...state, status: "published", media_id: pub.id, attempts, error: null,
    });
    await store.set("last_published_day", kstDay());
    log.push(`${target.id}: 게시 완료 media_id=${pub.id}`);
    await notify(store, `게시 완료: ${target.id}`, `릴스가 게시됐습니다.\nmedia_id: ${pub.id}\n${target.blog_url || ""}`);
  } catch (e) {
    log.push(`ERROR: ${e.message}`);
    await notify(store, "게시 함수 오류", e.message);
  } finally {
    console.log(log.join(" | ") || "no-op");
  }
};

export const config = {
  // UTC 10:00~13:59 매 5분 = KST 19:00~22:59 (숏폼 기준의 권장 게시 창)
  schedule: "*/5 10-13 * * *",
};
