// Which Supabase project this bundle talks to. Read from the project URL rather than the
// hostname: prod is served from app.aioncover.com, chat.aioncover.com and rc.app.aioncover.com
// alike, and a hostname check would have to know every one of them.
const PROD_PROJECT_REF = "dvmhwsmunvfdxnvckdom";

export const isProductionProject = (): boolean =>
  String(import.meta.env.VITE_SUPABASE_URL ?? "").includes(PROD_PROJECT_REF);

/**
 * The knowledge base was shown as "Soon" on prod while prod had no Voyage and Jina keys.
 * They were set on 2026-10-19 and the first live house's site was crawled there on
 * 2026-11-02, so it opens everywhere now. Kept as a function: the callers are the switch,
 * and the next "not yet" will want the same one.
 */
export const knowledgeComingSoon = (): boolean => false;
