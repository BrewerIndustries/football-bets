#!/usr/bin/env node
/**
 * Adaptive score poller.
 *
 * ESPN's scoreboard moves every ~10s during live play, so scores are polled at
 * 15s while a game is in progress.
 *
 * It is *schedule-aware* rather than merely slow when idle. The scoreboard
 * payload is ~224KB, so heartbeating it every two minutes cost roughly 160MB a
 * day to be told nothing had changed. Kickoff times are known in advance, so
 * the worker first asks the app's own cached schedule — a local DB read that
 * makes no upstream request — whether anything is happening:
 *
 *   a game in progress        -> fetch the scoreboard, poll every 15s
 *   kickoff imminent or past  -> fetch the scoreboard, poll every 15s
 *   otherwise                 -> sleep toward kickoff, fetching nothing
 *
 * A refresh still runs every few hours so a new week's schedule appears during
 * a quiet stretch.
 *
 *   node scripts/live-worker.mjs [--port 4780] [--live-ms 15000] [--idle-ms 1800000]
 */

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const PORT = Number(arg("port", process.env.PORT || 4780));
const LIVE_MS = Number(arg("live-ms", 15000));
/** Longest the worker will sleep before re-checking the local schedule. */
const IDLE_MS = Number(arg("idle-ms", 1800000));
/** How close to kickoff the worker starts fetching the scoreboard again. */
const LEAD_MS = Number(arg("lead-ms", 120000));
/** Refresh the schedule this often even when nothing is happening. */
const REFRESH_MS = Number(arg("refresh-ms", 6 * 3600 * 1000));
const TOKEN = process.env.JARVIS_TOKEN || "";
const URL = `http://127.0.0.1:${PORT}/api/grade`;
const STATUS_URL = `http://127.0.0.1:${PORT}/api/live-status`;

const log = (...m) => console.log(new Date().toISOString(), ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let consecutiveFailures = 0;
let lastFetchAt = 0;

/** Local, cached, no upstream request. */
async function status() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(STATUS_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

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
    lastFetchAt = Date.now();
    if (body.graded > 0) log(`settled ${body.graded} bet(s)`);
    return Number(body.live) || 0;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  log(`live worker up — port ${PORT}, ${LIVE_MS}ms while live, schedule-aware when idle`);
  let announced = null;

  for (;;) {
    let wait = IDLE_MS;
    try {
      const st = await status();
      const now = Date.now();
      const untilKickoff = st.nextKickoff ? new Date(st.nextKickoff).getTime() - now : Infinity;
      const dueRefresh = now - lastFetchAt > REFRESH_MS;

      // Fetch the scoreboard only when it could actually tell us something new.
      const shouldFetch =
        st.live > 0 || st.overdue || untilKickoff <= LEAD_MS || dueRefresh || st.games === 0;

      if (shouldFetch) {
        const live = await tick();
        if (announced !== live) {
          log(
            live > 0
              ? `${live} game(s) live — polling every ${LIVE_MS / 1000}s`
              : "nothing live — checking the schedule",
          );
          announced = live;
        }
        wait =
          live > 0
            ? LIVE_MS
            : Math.min(IDLE_MS, Math.max(LEAD_MS, untilKickoff - LEAD_MS));
      } else {
        wait = Math.min(IDLE_MS, Math.max(30000, untilKickoff - LEAD_MS));
        if (announced !== -1) {
          const mins = Number.isFinite(untilKickoff) ? Math.round(untilKickoff / 60000) : null;
          log(
            mins === null
              ? "nothing scheduled — idling without fetching"
              : `nothing live — next kickoff in ${mins}m, idling without fetching`,
          );
          announced = -1;
        }
      }
    } catch (e) {
      consecutiveFailures++;
      log(`poll failed (${consecutiveFailures}): ${e.message}`);
      wait = Math.min(IDLE_MS, 5000 * Math.min(consecutiveFailures, 6));
    }
    await sleep(wait);
  }
}

main().catch((e) => {
  log("fatal:", e);
  process.exit(1);
});
