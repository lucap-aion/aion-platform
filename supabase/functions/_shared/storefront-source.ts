// ==============================|| A LOCKED DOOR IS NOT A FINDING ||============================== //
//
// The storefront stage re-detects a house's catalogue from scratch every time it runs, and
// it runs again on every re-onboarding. Detection can only ever report what happened during
// that one pass, and one of its answers — "we were refused" — says nothing whatsoever about
// the house. It is a statement about a firewall.
//
// Written over an existing source, that statement did real damage. Ferragamo was read as
// `structured`, 1,783 pieces with prices, categories and photography in `storefront_products`.
// Days later the site put a bot challenge in front of us; detection refused 8 of 12 requests,
// concluded `blocked`, and the upsert wrote platform 'blocked' with enabled false over the
// working source. sync-storefront selects only enabled rows whose platform is shopify,
// structured or feed, so the catalogue stopped refreshing there and then — silently, with the
// stage recording `products: 0` and the screen telling an admin to go and ask the house for
// the feed it had already, in effect, given us.
//
// So: a refusal never demotes a source that is working and has actually delivered a
// catalogue. It is recorded as the failed attempt it is, and everything else is left alone.
// An empty read is a different matter and is not covered here — "we looked and there is
// nothing" IS a finding about the house, and the caller still records it.

/** The platforms `sync-storefront` reads: enabled rows whose platform is one of these. */
export const SYNCABLE_PLATFORMS = ["shopify", "structured", "feed"];

export type PriorSource = { platform?: string | null; enabled?: boolean | null } | null;

/**
 * Whether a pass that was REFUSED should leave an existing source untouched.
 *
 * True only when all three hold: we were turned away rather than finding nothing, the brand
 * already holds pieces, and the source that put them there is one the sync still reads.
 */
export function refusalKeepsSource(
  args: { blocked: boolean; heldProducts: number; prior: PriorSource },
): boolean {
  if (!args.blocked) return false;
  if (args.heldProducts <= 0) return false;
  const prior = args.prior;
  if (!prior || prior.enabled !== true) return false;
  return SYNCABLE_PLATFORMS.includes(String(prior.platform ?? ""));
}
