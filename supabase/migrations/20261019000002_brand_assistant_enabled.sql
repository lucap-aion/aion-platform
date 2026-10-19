-- Whether a brand's own users see the AI Assistant and the knowledge base.
--
-- Both shipped to every brand at once on dev. Promoting them to prod would have put two new
-- screens, and an assistant with no knowledge behind it, in front of a live client's
-- boutique staff on the day of the deploy. With the flag off a brand keeps exactly the
-- navigation it had: "Ask the data" instead of the Assistant, no Knowledge.
--
-- Default true, so a brand created from here on (a prospect being onboarded) gets the
-- assistant it is being shown. Brands that were live before the assistant existed are
-- switched off by hand on prod, once, not by this file.
--
-- A display flag like demo_assistant_only: the tenant lookup that reads it also runs for
-- logged-out visitors, and anon holds column-level grants on brands, so the column has to be
-- granted with it or every anonymous brand lookup fails with 42501.

alter table public.brands
  add column if not exists assistant_enabled boolean not null default true;

grant select (assistant_enabled) on public.brands to anon;
