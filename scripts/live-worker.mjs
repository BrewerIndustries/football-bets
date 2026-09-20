#!/usr/bin/env node
/**
 * Adaptive score poller.
 *
 * cron can't go below one minute, but ESPN's scoreboard moves every ~10s during
 * live play — so a 2-minute cron left scores up to two minutes stale. This is a
 * long-running worker instead: it polls fast while a game is in progress and
 * drops to a slow heartbeat when none is, so a quiet Tuesday costs almost
 * nothing while a Sunday afternoon stays within a few seconds of the broadcast.
 *
 * It drives the app's own /api/grade endpoint, which refreshes the scoreboard
 * and settles anything now final, and reports how many games are live so this
 * loop can pace itself off a single response.
 *
 *   node scripts/live-worker.mjs [--port 4780] [--live-ms 15000] [--idle-ms 120000]
 */

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const PORT = Number(arg("port", process.env.PORT || 4780));
const LIVE_MS = Number(arg("live-ms", 15000));
const IDLE_MS = Number(arg("idle-ms", 120000));
const TOKEN = process.env.JARVIS_TOKEN || "";
const URL = `http://127.0.0.1:${PORT}/api/grade`;

const log = (...m) => console.log(new Date().toISOString(), ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let consecutiveFailures = 0;

async function tick() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
      signal: controller.signal,
    });
    const body = await res.json();
    if (!res.ok || body.ok === false) throw new Error(body.error ?? `HTTP ${res.status}`);
    consecutiveFailures = 0;
    if (body.graded > 0) log(`settled ${body.graded} bet(s)`);
    return Number(body.live) || 0;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  log(`live worker up — port ${PORT}, ${LIVE_MS}ms while live, ${IDLE_MS}ms idle`);
  let wasLive = -1;
  for (;;) {
    let live = 0;
    try {
      live = await tick();
      if (live !== wasLive) {
        log(live > 0 ? `${live} game(s) live — polling every ${LIVE_MS / 1000}s` : "nothing live — idling");
        wasLive = live;
      }
    } catch (e) {
      consecutiveFailures++;
      log(`poll failed (${consecutiveFailures}): ${e.message}`);
      // Back off on a sustained outage rather than hammering a down app.
      await sleep(Math.min(IDLE_MS, 5000 * Math.min(consecutiveFailures, 6)));
      continue;
    }
    await sleep(live > 0 ? LIVE_MS : IDLE_MS);
  }
}

main().catch((e) => {
  log("fatal:", e);
  process.exit(1);
});
