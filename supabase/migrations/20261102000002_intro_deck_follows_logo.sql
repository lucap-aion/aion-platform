-- The intro deck is co-branded with the house's logo, and the logo arrives after the deck more
-- often than not: onboarding's first pass finds a 404 or a favicon, an admin uploads the real
-- wordmark an hour later, and the deck already built says "NO BRAND LOGO" (My Style Bags,
-- 2026-11-02) or carries the wrong picture (L.G.R, same day). Nothing rebuilt it. Now a change
-- to either logo re-queues the deck, when there is a deck to rebuild. The onboarding tick picks
-- it up within the minute; the stage's own gate still waits for catalogue pictures.
create or replace function public.brands_logo_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.logo_big is distinct from old.logo_big or new.logo_small is distinct from old.logo_small)
     and exists (
       select 1 from public.brand_onboarding
       where brand_id = new.id and stage = 'intro_deck' and status in ('done', 'failed', 'skipped'))
  then
    perform public.queue_onboarding_stages(new.id, array['intro_deck']);
  end if;
  return new;
end
$$;

drop trigger if exists brands_logo_requeues_intro_deck on public.brands;
create trigger brands_logo_requeues_intro_deck
  after update of logo_big, logo_small on public.brands
  for each row execute function public.brands_logo_changed();
