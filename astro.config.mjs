// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';

// Deployed to GitHub Pages as the user site (served at the root domain below).
// The site is static; React is used only as an island for the AI chat widget.
export default defineConfig({
  site: 'https://souhaibbenfarhat.github.io',
  integrations: [tailwind({ applyBaseStyles: false }), react()],
});
