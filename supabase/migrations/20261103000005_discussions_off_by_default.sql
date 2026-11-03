-- Discussions is opt-in: a brand created from here on starts with it OFF, and an
-- AION admin switches it on (Admin → brand → Discussions). Existing brands keep
-- whatever they have — every prod brand is off already; on dev, Luisa Beccaria
-- (who asked for it) and the demo brands stay on.
alter table public.brands alter column discussions_enabled set default false;
