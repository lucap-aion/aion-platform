import type { SupabaseClient } from "@supabase/supabase-js";
// Imported through the alias, not "./client": tests mock
// "@/integrations/supabase/client", and a relative import here would slip past
// the mock and reach the real network client.
import { supabase } from "@/integrations/supabase/client";

// types.ts is generated from the database schema and has drifted well behind it —
// insurance_quotes, aion_pricing_terms, deck_templates, brand_deck_outputs,
// brand_onboarding and brand_commercial_progress have all shipped since it was
// last regenerated. The typed client rejects every one of them.
//
// The codebase has been working around this with `as never` scattered at each
// call site, which silences the error but also silences the NEXT one — a typo in
// a column name reads exactly the same as a table the types have not caught up
// with. One named escape hatch keeps that visible: anything reached through
// `untyped` is knowingly unchecked, and the list above is the backlog for the
// next `supabase gen types` run.
export const untyped = supabase as unknown as SupabaseClient;
