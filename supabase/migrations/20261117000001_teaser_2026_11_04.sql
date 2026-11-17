-- The intro teaser, Giulio's 2026-11-04 revision (14 slides, was 12).
--
-- A new deck renames every media part, so the slot map is redone from the file, not carried
-- over. What the brand's imagery is in this version:
--
--   slide 5   image10.jpeg  store       "Luxury brands strive to build loyalty" — the boutique
--   slide 6   image12.jpeg  product     the piece on the app mockup (the template's ring)
--   slide 11  image32.jpeg  ambassador  benefits, left  — Experience
--   slide 11  image30.jpeg  lifestyle   benefits, middle — Revenues (a bag in hand)
--   slide 11  image31.jpeg  lifestyle   benefits, right — Data (rings on hands)
--   slide 12  image36.jpeg  ambassador  "AION service results" — the editorial portrait
--
-- NOT slots: image11.png is a phone screenshot with a "Gold chronograph" drawn into it, on
-- slides 6 and 9; the pioneer wall on slide 10 is AION's own claim; the team on 13 is AION's.
--
-- "1-2 years, then renewable" is gone from the deck (it says "2 years" now), so that text slot
-- goes. "Leather bag" above the product name becomes the piece's category.
--
-- The corner wordmark is still ppt/media/image2.png, so logo_anchor is unchanged.

update public.deck_templates set
  name = 'AION intro teaser (14 slides, 2026-11-04)',
  storage_path = 'templates/AION_Teaser_2026-11-04.pptx',
  slots = '[
    {"media":"ppt/media/image10.jpeg","slide":5, "role":"store",     "note":"loyalty slide — a boutique with the brand sign legible"},
    {"media":"ppt/media/image12.jpeg","slide":6, "role":"product",   "note":"the piece inside the app mockup. Its NAME and CATEGORY on the slide follow it via {{PRODUCT_NAME}} / {{PRODUCT_CATEGORY}}."},
    {"media":"ppt/media/image32.jpeg","slide":11,"role":"ambassador","note":"benefits, left (Experience) — the face of the house"},
    {"media":"ppt/media/image30.jpeg","slide":11,"role":"lifestyle", "note":"benefits, middle (Revenues) — the product in use"},
    {"media":"ppt/media/image31.jpeg","slide":11,"role":"lifestyle", "note":"benefits, right (Data) — the product being worn"},
    {"media":"ppt/media/image36.jpeg","slide":12,"role":"ambassador","note":"results slide — the large editorial portrait"}
  ]'::jsonb,
  text_slots = '[
    {"find":"Bee Pink Gold","replace_with":"{{PRODUCT_NAME}}","note":"the product named on the app mockup"},
    {"find":"Leather bag","replace_with":"{{PRODUCT_CATEGORY}}","note":"the category line above it"}
  ]'::jsonb
where key = 'intro_teaser';
