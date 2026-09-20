"use client";

import { useCallback, useEffect, useState } from "react";
import Dashboard from "./Dashboard";
import BetTable from "./BetTable";
import BetForm from "./BetForm";
import Schedule from "./Schedule";
import LiveNow from "./LiveNow";
import { Button, Card, Empty } from "./ui";
import type { Stats } from "@/lib/stats";
import type { Bet, BetStatus, Game } from "@/lib/types";
import type { openPortfolio, Valuation } from "@/lib/valuation";
import { winPayout } from "@/lib/grade";

type SyncInfo = { startedAt: string; finishedAt: string | null; ok: boolean; detail: string } | null;

type Boot = {
  bets: Bet[];
  games: Game[];
  valuations: Record<string, Valuation>;
  portfolio: ReturnType<typeof openPortfolio>;
  pricedAt: string | null;
  stats: Stats;
  current: { season: number; seasonType: number; week: number } | null;
  kalshi: { configured: boolean; base: string; reason?: string };
  sync: { games: SyncInfo; kalshi: SyncInfo };
  hasSchedule: boolean;
  writesLocked: boolean;
};

const TABS = ["Dashboard", "Bets", "Schedule", "Sync"] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [tab, setTab] = useState<Tab>("Dashboard");
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Bet | null>(null);
  const [prefillGame, setPrefillGame] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/bootstrap", { cache: "no-store" });
    if (!res.ok) throw new Error(`Load failed (${res.status})`);
    setBoot((await res.json()) as Boot);
  }, []);

  useEffect(() => {
    load().catch((e) => setFlash({ tone: "err", text: (e as Error).message }));
  }, [load]);

  // While a game is in progress the scoreboard moves every ~10s, and the live
  // worker is refreshing the server side at that pace — so read it back on a
  // similar interval. This request only hits local SQLite; the upstream feed is
  // the worker's job, not the browser's. With nothing live the polling stops
  // entirely rather than burning requests on a quiet Tuesday.
  const anyLive = boot?.games.some((g) => g.state === "in") ?? false;
  useEffect(() => {
    if (!anyLive) return;
    const id = window.setInterval(() => {
      load().catch(() => {});
    }, 15000);
    return () => window.clearInterval(id);
  }, [anyLive, load]);

  const say = (tone: "ok" | "err", text: string) => {
    setFlash({ tone, text });
    window.setTimeout(() => setFlash(null), 6000);
  };

  async function post(path: string, label: string) {
    setBusy(label);
    try {
      const res = await fetch(path, { method: "POST" });
      const body = await res.json();
      if (!res.ok || body.ok === false) throw new Error(body.error ?? `Failed (${res.status})`);
      await load();
      return body;
    } catch (e) {
      say("err", (e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  const syncKalshi = async () => {
    const r = await post("/api/sync/kalshi", "kalshi");
    if (r) {
      say(
        "ok",
        `Kalshi: ${r.created} new, ${r.updated} updated, ${r.linkedGames} linked to games` +
          (r.unlinked?.length ? ` · ${r.unlinked.length} could not be matched to a game` : ""),
      );
    }
  };

  const syncGames = async (full: boolean) => {
    const r = await post(`/api/sync/games${full ? "?full=1" : ""}`, "games");
    if (r) say("ok", `Schedule: ${r.games} games cached (season ${r.season}, week ${r.week}).`);
  };

  const gradeAll = async () => {
    const r = await post("/api/grade", "grade");
    if (r) {
      say(
        "ok",
        r.graded === 0
          ? "Nothing new to settle — every open bet is still in play."
          : `Settled ${r.graded} bet${r.graded === 1 ? "" : "s"} from final scores.`,
      );
    }
  };

  async function saveBet(payload: Partial<Bet>) {
    const url = editing ? `/api/bets/${editing.id}` : "/api/bets";
    const res = await fetch(url, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Save failed (${res.status})`);
    }
    await load();
    say("ok", editing ? "Bet updated." : "Bet added.");
  }

  async function gradeBet(bet: Bet, status: BetStatus) {
    const payoutCents =
      status === "won" ? winPayout(bet) : status === "push" ? bet.stakeCents : 0;
    const res = await fetch(`/api/bets/${bet.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, payoutCents }),
    });
    if (!res.ok) return say("err", `Could not settle that bet (${res.status}).`);
    await load();
  }

  async function removeBet(bet: Bet) {
    if (!window.confirm("Delete this bet? This can't be undone.")) return;
    const res = await fetch(`/api/bets/${bet.id}`, { method: "DELETE" });
    if (!res.ok) return say("err", `Delete failed (${res.status}).`);
    await load();
    say("ok", "Bet deleted.");
  }

  if (!boot) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10">
        <p style={{ color: "var(--muted)" }}>Loading…</p>
      </main>
    );
  }

  const locked = boot.writesLocked;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Football Bets</h1>
          <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
            {boot.current
              ? `NFL ${boot.current.season} · week ${boot.current.week}`
              : "No schedule cached yet"}
            {" · "}
            {boot.bets.length} bet{boot.bets.length === 1 ? "" : "s"} tracked
            {anyLive && (
              <>
                {" · "}
                <span style={{ color: "var(--neg)", fontWeight: 600 }}>
                  live — refreshing every 15s
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={gradeAll} disabled={busy !== null}>
            {busy === "grade" ? "Checking…" : "Refresh scores"}
          </Button>
          <Button onClick={syncKalshi} disabled={busy !== null || !boot.kalshi.configured}
                  title={boot.kalshi.configured ? "Import positions and settlements" : boot.kalshi.reason}>
            {busy === "kalshi" ? "Syncing…" : "Sync Kalshi"}
          </Button>
          {!locked && (
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setPrefillGame(null);
                setFormOpen(true);
              }}
            >
              Add bet
            </Button>
          )}
        </div>
      </header>

      {flash && (
        <div
          className="mb-4 rounded-lg border px-3 py-2 text-sm"
          style={{
            borderColor: flash.tone === "ok" ? "var(--line-strong)" : "var(--neg)",
            background: "var(--surface)",
            color: flash.tone === "ok" ? "var(--ink-2)" : "var(--neg)",
          }}
        >
          {flash.text}
        </div>
      )}

      <nav className="mb-4 flex gap-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="rounded-lg px-3 py-1.5 text-sm font-medium"
            style={{
              background: tab === t ? "var(--surface)" : "transparent",
              color: tab === t ? "var(--ink)" : "var(--muted)",
              border: `1px solid ${tab === t ? "var(--line-strong)" : "transparent"}`,
            }}
          >
            {t}
          </button>
        ))}
      </nav>

      <LiveNow games={boot.games} bets={boot.bets} valuations={boot.valuations} />

      {tab === "Dashboard" && (
        <Dashboard stats={boot.stats} portfolio={boot.portfolio} pricedAt={boot.pricedAt} />
      )}

      {tab === "Bets" && (
        <Card title="Every bet" subtitle="Kalshi rows re-derive on each sync; your notes on them are kept.">
          <BetTable
            bets={boot.bets}
            valuations={boot.valuations}
            locked={locked}
            onEdit={(b) => {
              setEditing(b);
              setPrefillGame(null);
              setFormOpen(true);
            }}
            onDelete={removeBet}
            onGrade={gradeBet}
          />
        </Card>
      )}

      {tab === "Schedule" && (
        <Schedule
          games={boot.games}
          bets={boot.bets}
          current={boot.current}
          locked={locked}
          onAddForGame={(gameId) => {
            setEditing(null);
            setPrefillGame(gameId);
            setFormOpen(true);
          }}
        />
      )}

      {tab === "Sync" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card
            title="Kalshi"
            subtitle={boot.kalshi.configured ? boot.kalshi.base : "Not configured"}
            right={
              <Button onClick={syncKalshi} disabled={busy !== null || !boot.kalshi.configured}>
                {busy === "kalshi" ? "Syncing…" : "Sync now"}
              </Button>
            }
          >
            {boot.kalshi.configured ? (
              <p className="text-sm" style={{ color: "var(--ink-2)" }}>
                Open positions and settled markets are imported as bets, matched to the schedule by
                ticker. Read-only: the app never places or cancels an order.
              </p>
            ) : (
              <p className="text-sm" style={{ color: "var(--neg)" }}>
                {boot.kalshi.reason}
              </p>
            )}
            <SyncLine label="Last run" info={boot.sync.kalshi} />
          </Card>

          <Card
            title="NFL schedule & scores"
            subtitle="ESPN public feed — no key required"
            right={
              <div className="flex gap-2">
                <Button onClick={() => syncGames(false)} disabled={busy !== null}>
                  {busy === "games" ? "…" : "This week"}
                </Button>
                <Button onClick={() => syncGames(true)} disabled={busy !== null}>
                  Full season
                </Button>
              </div>
            }
          >
            <p className="text-sm" style={{ color: "var(--ink-2)" }}>
              Scores drive automatic grading for manual bets linked to a game. Kalshi bets are left
              alone — their own settlement record decides them.
            </p>
            <SyncLine label="Last run" info={boot.sync.games} />
          </Card>

          {locked && (
            <Card title="Writes are locked">
              <Empty>
                A JARVIS_TOKEN is set, so edits and syncs need that token. Unset it for an open,
                tailnet-only deployment.
              </Empty>
            </Card>
          )}
        </div>
      )}

      <BetForm
        open={formOpen}
        games={boot.games}
        editing={editing}
        prefillGameId={prefillGame}
        onClose={() => setFormOpen(false)}
        onSave={saveBet}
      />
    </main>
  );
}

function SyncLine({ label, info }: { label: string; info: SyncInfo }) {
  return (
    <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
      {label}:{" "}
      {info ? (
        <>
          {new Date(info.startedAt).toLocaleString()} ·{" "}
          <span style={{ color: info.ok ? "var(--ink-2)" : "var(--neg)" }}>
            {info.ok ? info.detail : `failed — ${info.detail}`}
          </span>
        </>
      ) : (
        "never"
      )}
    </p>
  );
}
