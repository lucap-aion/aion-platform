-- Re-label the knowledge documents the crawler mis-categorised.
--
-- categorize() ran on url + title + the first 300 characters of the page. On a
-- luxury site those 300 characters are the global navigation — "World of LB",
-- "About us", "Sustainability", "Craft" — which matched the storytelling rule on
-- EVERY page, before the product rule was ever reached. Result: 112 of Luisa
-- Beccaria's 141 "storytelling" documents are product pages, 67 of Pomellato's
-- 264, 43 of Roberto Coin's 217.
--
-- That doesn't just skew document generation. The assistant is told to use
-- search_knowledge for the brand STORY and the catalogue for products; when the
-- story bucket is full of spec sheets, a question about the house retrieves
-- tumblers. The crawler is fixed (URL first, then title, body text last); this
-- corrects what is already indexed.
--
-- Only ever relabels TO 'product', and only when the page really is one — a URL
-- under /products/ or body text with an add-to-cart / composition / SKU block.
-- Nothing is deleted and no chunk is re-embedded: category is metadata.

update public.brand_knowledge_docs
set category = 'product'
where source_type = 'url'
  and category in ('storytelling', 'policy', 'other')
  and (
    coalesce(source_url, '') ~* '/(products?|p|item|articolo|prodotti?)/[^/]+'
    or coalesce(content, '') ~* '(add to (cart|bag)|aggiungi al carrello|select (a )?size|scegli la taglia|composition\s*:|composizione\s*:|product details)'
  );

-- Chunks don't carry their own category (they join to the doc), so there is
-- nothing further to keep in step.
