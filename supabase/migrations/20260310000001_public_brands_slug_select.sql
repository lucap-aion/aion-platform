-- Allow public tenant lookup by slug before authentication.
-- This powers branded landing/login pages using /{slug}/* routes without requiring a logged-in session.
CREATE POLICY "Public can read brands by slug"
  ON public.brands FOR SELECT
  TO public
  USING (slug IS NOT NULL AND slug <> '');
