-- The activation threshold, per brand.
--
-- A cover is recorded as `blocked` instead of `live` when the piece's retail
-- price is below a floor. That floor was the literal 999 in the integration
-- service — a jewellery number, applied to every brand:
--
--   policy_status = "live" if rrp > 999 else "blocked"
--
-- It is wrong for anyone whose catalogue is not jewellery. A house selling
-- footwear, small leather goods, silk and belts would have a large share of its
-- volume recorded blocked, silently, with no way to change it short of a deploy.
--
-- So the floor becomes brand configuration, next to the ceiling that already
-- lives there. The two are NOT a symmetric range and the comment below says so:
-- above `max_covered_value` a piece is still covered, capped; below
-- `min_covered_value` it is not covered at all.
--
-- DEFAULT 999 is deliberate: every brand that exists today keeps exactly the
-- behaviour it has now — Roberto Coin included — so this migration changes no
-- outcome anywhere. A brand that needs a different floor is a data change, and
-- new brands inherit the jewellery default until someone sets theirs.
-- double precision, not numeric, to match max_covered_value: PostgREST serialises
-- numeric as a JSON *string* and double precision as a number, and one of these two
-- columns arriving as "999" while its sibling arrives as 100000 is exactly the kind of
-- difference that survives review and breaks a comparison later.
alter table public.brands
  add column if not exists min_covered_value double precision not null default 999;

comment on column public.brands.min_covered_value is
  'Retail price (per unit, VAT inclusive) at or below which a cover is recorded as blocked instead of live. Not the mirror of max_covered_value: a piece above the ceiling is still covered, capped at it, while a piece below this floor is not covered at all. Default 999 preserves the historic platform-wide behaviour: the covered range starts at 1000, so the floor that expresses it is 999 (a piece at exactly 1000 is live). It is not an off-by-one.';

-- The floor and the ceiling bound the same thing from opposite sides, so a floor at or
-- above the ceiling leaves no coverable range at all: every piece is either blocked
-- (below the floor) or... still blocked, because the floor is higher. Nothing about that
-- fails loudly — covers keep being written, they are simply all inactive, and the first
-- symptom is an insurer file that stays empty. Cheaper to make it unsavable.
alter table public.brands
  drop constraint if exists brands_covered_value_range;
alter table public.brands
  add constraint brands_covered_value_range
  check (min_covered_value < max_covered_value);
