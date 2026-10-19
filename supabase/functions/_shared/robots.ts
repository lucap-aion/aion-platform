// ==============================|| WHAT THE HOUSE ASKED FOR ||============================== //
//
// We read robots.txt for its `Sitemap:` lines and ignored everything else in it — the
// Disallow rules and the Crawl-delay alike. That is the wrong posture for a company crawling
// the websites of the clients it is trying to sign, and it is part of why we get challenged:
// a crawler that ignores the file is exactly what a bot wall is built to stop.
//
// Damiani is the case in point. Its robots.txt PERMITS the product pages its firewall
// blocks, asks for five seconds between requests, and disallows a handful of paths that are
// no use to anyone. Honouring it costs us nothing we want and is the difference between a
// crawler a house would allowlist and one it would not.

export type RobotsRules = {
  /** Path patterns this agent may not fetch. */
  disallow: string[];
  /** Path patterns that override a Disallow, per the longest-match rule. */
  allow: string[];
  /** Seconds the house asks us to wait between requests, when it says. */
  crawlDelaySeconds: number | null;
};

export const NO_RULES: RobotsRules = { disallow: [], allow: [], crawlDelaySeconds: null };

/** The name we answer to in robots.txt. */
export const AGENT_TOKEN = "aionknowledgebot";

/**
 * Who we tell a website we are — one string, used everywhere we read a brand's own site.
 *
 * It used to end "Googlebot/2.1", and that token was load-bearing: damiani.com serves search
 * engines and refuses everyone else, so it was the only reason we could read the site at
 * all. Measured across eight houses, it changed the answer on exactly one.
 *
 * It is gone anyway, for two reasons that point the same way. It is untrue, and a house
 * being asked to allowlist us deserves to be told what it is allowlisting. And it is
 * fragile: Cloudflare's verified-bot check validates Googlebot by reverse DNS against
 * Google's own address ranges, which an edge function will never pass — so the access it
 * buys lasts exactly until somebody ticks a box, and a pipeline resting on it would fail
 * without warning and for reasons nobody would find.
 *
 * There were also SEVEN of these strings across the pipeline — "AION onboarding", "AION
 * storefront sync", "AION brand onboarding" — which made us unallowlistable in principle:
 * there was no single thing to name. Now there is.
 *
 * Asset fetches keep their own agents. Pulling a JPEG off a CDN to re-host it in a client's
 * own portal is a different act from crawling a site, and hotlink protection reads the
 * header differently.
 */
export const AION_UA =
  "Mozilla/5.0 (compatible; AIONKnowledgeBot/1.0; +https://aioncover.com/bot)";

/**
 * The rules that apply to one agent.
 *
 * Groups are keyed by `User-agent:`, several of which may share one group. The most specific
 * group wins: a group naming our token beats the wildcard, and the wildcard is used only
 * when nothing names us — which is what the standard says and what a house expects.
 */
export function parseRobots(text: string, agentToken: string): RobotsRules {
  const token = agentToken.toLowerCase();
  type Group = { agents: string[]; rules: RobotsRules };
  const groups: Group[] = [];
  let current: Group | null = null;
  // Consecutive User-agent lines share the group that follows them.
  let collectingAgents = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const at = line.indexOf(":");
    if (at < 0) continue;
    const field = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();

    if (field === "user-agent") {
      if (!collectingAgents || !current) {
        current = { agents: [], rules: { disallow: [], allow: [], crawlDelaySeconds: null } };
        groups.push(current);
        collectingAgents = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue;
    collectingAgents = false;

    // An EMPTY Disallow means "nothing is disallowed" and must not become a rule matching
    // every path — which is how a careless parser blocks an entire site.
    if (field === "disallow" && value) current.rules.disallow.push(value);
    else if (field === "allow" && value) current.rules.allow.push(value);
    else if (field === "crawl-delay") {
      const n = Number(value.replace(",", "."));
      if (Number.isFinite(n) && n >= 0) current.rules.crawlDelaySeconds = n;
    }
  }

  const named = groups.find((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  const wildcard = groups.find((g) => g.agents.includes("*"));
  return (named ?? wildcard)?.rules ?? NO_RULES;
}

/** Does `pattern` match the start of `path`? Handles the two wildcards robots.txt defines. */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const parts = body.split("*");

  let at = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const found = i === 0 ? (path.startsWith(part) ? 0 : -1) : path.indexOf(part, at);
    if (found < 0) return false;
    at = found + part.length;
  }
  return anchored ? at === path.length : true;
}

/** How specific a matching rule is. Longest wins, which is the standard's tie-break. */
function bestMatch(patterns: string[], path: string): number {
  let best = -1;
  for (const p of patterns) if (matches(p, path)) best = Math.max(best, p.replace(/\*|\$/g, "").length);
  return best;
}

/**
 * May we fetch this URL?
 *
 * Allow beats Disallow when it is at least as specific, which is what lets a house disallow
 * a whole section and re-admit one page inside it.
 */
export function robotsAllows(rules: RobotsRules, url: string): boolean {
  let path: string;
  try {
    const u = new URL(url);
    path = u.pathname + u.search;
  } catch {
    return true;
  }
  const denied = bestMatch(rules.disallow, path);
  if (denied < 0) return true;
  return bestMatch(rules.allow, path) >= denied;
}

/** What we store on the source, so the worker does not refetch robots.txt every tick. */
export function rulesToConfig(rules: RobotsRules): Record<string, unknown> {
  return {
    robots_disallow: rules.disallow.slice(0, 200),
    robots_allow: rules.allow.slice(0, 200),
    robots_crawl_delay: rules.crawlDelaySeconds,
  };
}

/** The other direction, tolerant of a config written before this existed. */
export function rulesFromConfig(config: Record<string, unknown> | null | undefined): RobotsRules {
  const c = config ?? {};
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const delay = c.robots_crawl_delay;
  return {
    disallow: list(c.robots_disallow),
    allow: list(c.robots_allow),
    crawlDelaySeconds: typeof delay === "number" && Number.isFinite(delay) ? delay : null,
  };
}
