// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

// Deployed to GitHub Pages as the user site (served at the root domain below).
// The site is static; React is used only as an island for the AI chat widget.
export default defineConfig({
  site: 'https://souhaibbenfarhat.github.io',
  // The sitemap is generated from the actual routes, replacing a hand-written public/sitemap.xml
  // that had already drifted: it listed /privacy while the page's own canonical says /privacy/,
  // and carried a lastmod typed months before the content last changed. Nothing to remember on
  // the next page, and it cannot disagree with the canonical it's built from.
  //
  // No changefreq/priority: Google ignores both, so the old file's values bought nothing. No
  // lastmod either — the only value available at build time is "now", which would claim every
  // page changed on every deploy, and an unreliable lastmod is one search engines learn to skip.
  //
  // @astrojs/sitemap is pinned to an exact 3.2.1 in package.json, not carets: 3.3+ reads the
  // `astro:build:done` route payload as Astro 5 shapes it and dies on `routes.reduce` under
  // Astro 4. It declares no peer range, so npm will happily install a version that breaks the
  // build. Unpin it when this repo moves to Astro 5, not before.
  integrations: [tailwind({ applyBaseStyles: false }), react(), sitemap()],
});
