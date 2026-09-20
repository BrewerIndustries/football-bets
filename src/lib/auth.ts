import { NextRequest } from "next/server";

/**
 * Writes (creating, editing, grading or deleting bets; triggering a sync)
 * require a shared secret when one is configured. Accepts either:
 *   Authorization: Bearer <token>
 *   x-jarvis-token: <token>
 * With JARVIS_TOKEN unset, writes are open — fine on the Tailscale-only box,
 * and the UI says so. Reads are always open.
 */
export function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.JARVIS_TOKEN;
  if (!expected) return true;

  const bearer = req.headers.get("authorization");
  const fromBearer = bearer?.toLowerCase().startsWith("bearer ")
    ? bearer.slice(7).trim()
    : null;
  const provided = fromBearer ?? req.headers.get("x-jarvis-token");
  return provided === expected;
}

export const tokenIsConfigured = () => Boolean(process.env.JARVIS_TOKEN);
