// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// Deployed to GitHub Pages as the user site (served at the root domain below).
export default defineConfig({
  site: 'https://souhaibbenfarhat.github.io',
  integrations: [tailwind({ applyBaseStyles: false })],
});
