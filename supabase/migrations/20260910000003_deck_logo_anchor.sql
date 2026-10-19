-- Where a template's recurring wordmark lives, so the brand's logo can sit
-- opposite it.
--
-- Measured rather than assumed: diffing the master teaser against the deck a
-- human branded for Pasquale Bruni, they replaced 23 media files and added 14
-- more, and neither deck names the brand in text on any slide. The identity is
-- carried by imagery — above all by the wordmark that recurs bottom-left on nine
-- of the twelve slides, which is AION's in the master and the brand's in the
-- branded deck. Leaving it alone is what made every generated deck read as
-- generic.
--
-- brand-deck reads the anchor's position and height off each slide and mirrors
-- the brand's logo across the page, so a template that moves its wordmark does
-- not need this changed — only a template that renames the part does.
alter table public.deck_templates
  add column if not exists logo_anchor text;

comment on column public.deck_templates.logo_anchor is
  'Media part of the recurring AION wordmark. The brand logo is mirrored opposite it on every slide carrying it. NULL falls back to ppt/media/image2.png.';

update public.deck_templates
   set logo_anchor = 'ppt/media/image2.png'
 where key = 'intro_teaser' and logo_anchor is null;
