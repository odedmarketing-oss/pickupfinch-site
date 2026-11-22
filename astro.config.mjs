import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Static output, flat URLs, trailing slash on every URL (Project Plan 2026-11-19).
export default defineConfig({
  site: 'https://pickupfinch.com',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [sitemap()],
});
