-- A brand's slug is its address, so two brands cannot share one.
--
-- It is the customer-facing URL prefix — /rc for Roberto Coin, and
-- rc.app.aioncover.com redirects onto it in vercel.json — and nothing in the
-- database stopped two rows carrying the same one. Nothing stopped two rows
-- carrying the same WEBSITE either, which is worse than a cosmetic duplicate:
-- creating a brand now starts a pipeline, so a second "Pomellato" would crawl
-- the same site again, embed the same catalogue again, and leave two half-built
-- brands with no way to tell which is the real one.
--
-- The form checks for duplicates before it inserts, but a check in a form is a
-- courtesy, not a guarantee — two admins on the same call are enough to defeat
-- it. Verified first that the four existing brands are already distinct on both.
create unique index if not exists brands_slug_unique
  on public.brands (lower(slug)) where slug is not null and slug <> '';

-- Host only, ignoring scheme and any www., because https://www.pomellato.com and
-- pomellato.com are the same house.
create unique index if not exists brands_website_host_unique
  on public.brands (
    lower(regexp_replace(regexp_replace(website, '^https?://', ''), '^www\.', ''))
  ) where website is not null and website <> '';
