import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://kingtao.github.io',
  base: '/ralphy-sdd',
  output: 'static',
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'zh', 'ko', 'ja'],
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: true
    }
  }
});
