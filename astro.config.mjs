import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://raceupkc.com',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
});
