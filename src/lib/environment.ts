// Which Supabase project this bundle talks to. Read from the project URL rather than the
// hostname: prod is served from app.aioncover.com, chat.aioncover.com and rc.app.aioncover.com
// alike, and a hostname check would have to know every one of them.
const PROD_PROJECT_REF = "dvmhwsmunvfdxnvckdom";

export const isProductionProject = (): boolean =>
  String(import.meta.env.VITE_SUPABASE_URL ?? "").includes(PROD_PROJECT_REF);

/**
 * The knowledge base is shown as "Soon" on prod and cannot be opened there: crawling a
 * house's site and embedding it needs the Voyage and Jina keys, which prod does not have yet.
 * Flip this when they are set.
 */
export const knowledgeComingSoon = (): boolean => isProductionProject();
