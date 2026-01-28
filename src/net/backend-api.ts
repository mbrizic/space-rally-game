type VoteType = "up" | "down";

type HighScoreRow = {
  name: string;
  score: number; // milliseconds (lower is better)
  seed: string;
  t: number;
};

// Scores should always go to the production backend (never a local server).
const PROD_BACKEND_HTTP_ORIGIN = "https://spacerally.supercollider.hr";

function resolveBackendHttpOrigin(): string {
  const url = new URL(window.location.href);
  const override = url.searchParams.get("signal") ?? url.searchParams.get("signalWs");
  if (override) {
    if (override.startsWith("ws://") || override.startsWith("wss://")) {
      return override.replace(/^ws/, "http").replace(/\/(ws|api\/ws)\/?$/, "");
    }
    if (override.startsWith("http://") || override.startsWith("https://")) {
      const u = new URL(override);
      // Strip /ws or /api/ws if provided.
      u.pathname = u.pathname.replace(/\/(ws|api\/ws)\/?$/, "");
      u.search = "";
      return u.toString();
    }
  }
  return window.location.origin;
}

async function fetchJson(
  input: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<{ ok: boolean; status: number; json: any | null }> {
  const timeoutMs = init.timeoutMs ?? 1500;
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: ctrl.signal });
    const status = res.status;
    try {
      const json = await res.json();
      return { ok: res.ok, status, json };
    } catch {
      return { ok: res.ok, status, json: null };
    }
  } catch {
    return { ok: false, status: 0, json: null };
  } finally {
    window.clearTimeout(t);
  }
}

export async function postTrackVote(seed: string, type: VoteType): Promise<{ ok: boolean; upvotes?: number; downvotes?: number }> {
  const base = resolveBackendHttpOrigin();
  const u = new URL("/api/vote", base);
  const { ok, json } = await fetchJson(u.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seed, type }),
    timeoutMs: 2000
  });

  if (!ok || !json || json.ok !== true) return { ok: false };
  return {
    ok: true,
    upvotes: typeof json.upvotes === "number" ? json.upvotes : undefined,
    downvotes: typeof json.downvotes === "number" ? json.downvotes : undefined
  };
}

export async function getTrackVotes(seed: string): Promise<{ ok: boolean; upvotes: number; downvotes: number }> {
  const base = resolveBackendHttpOrigin();
  const u = new URL("/api/vote", base);
  u.searchParams.set("seed", seed);
  const { ok, json } = await fetchJson(u.toString(), { method: "GET", timeoutMs: 1500 });
  if (!ok || !json || json.ok !== true) return { ok: false, upvotes: 0, downvotes: 0 };
  return {
    ok: true,
    upvotes: typeof json.upvotes === "number" ? json.upvotes : 0,
    downvotes: typeof json.downvotes === "number" ? json.downvotes : 0
  };
}

export async function postHighScore(opts: { name: string; scoreMs: number; seed: string }): Promise<{ ok: boolean }> {
  const base = PROD_BACKEND_HTTP_ORIGIN;
  const u = new URL("/api/highscore", base);
  const { ok, json } = await fetchJson(u.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: opts.name, score: Math.floor(opts.scoreMs), seed: opts.seed }),
    timeoutMs: 2500
  });
  if (!ok || !json || json.ok !== true) return { ok: false };
  return { ok: true };
}

export async function getHighScores(opts?: { seed?: string; limit?: number }): Promise<{ ok: boolean; scores: HighScoreRow[] }> {
  const base = PROD_BACKEND_HTTP_ORIGIN;
  const u = new URL("/api/highscores", base);
  if (opts?.seed) u.searchParams.set("seed", opts.seed);
  if (typeof opts?.limit === "number") u.searchParams.set("limit", String(Math.floor(opts.limit)));

  const { ok, json } = await fetchJson(u.toString(), { method: "GET", timeoutMs: 2000 });
  if (!ok || !json || json.ok !== true || !Array.isArray(json.scores)) return { ok: false, scores: [] };

  const scores: HighScoreRow[] = [];
  for (const s of json.scores as any[]) {
    scores.push({
      name: typeof s?.name === "string" ? s.name : "anonymous",
      score: typeof s?.score === "number" ? s.score : 0,
      seed: typeof s?.seed === "string" ? s.seed : "0",
      t: typeof s?.t === "number" ? s.t : 0
    });
  }
  return { ok: true, scores };
}

export async function postGameStat(type: "played" | "finished" | "wrecked"): Promise<void> {
  const base = resolveBackendHttpOrigin();
  const u = new URL("/api/stats", base);
  await fetchJson(u.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type }),
    timeoutMs: 1000
  });
}
