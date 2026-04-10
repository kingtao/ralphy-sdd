import { ui, defaultLang, type Lang, type TranslationKey } from './ui';

/**
 * Base path from astro.config.mjs — must match the `base` option.
 * Includes leading slash, no trailing slash: "/ralphy-sdd"
 */
const BASE = '/ralphy-sdd';

/**
 * Strip the base path prefix from a pathname so that
 * i18n helpers see "/en/docs/" instead of "/ralphy-sdd/en/docs/".
 */
function stripBase(pathname: string): string {
  if (pathname.startsWith(BASE + '/')) {
    return pathname.slice(BASE.length);  // "/ralphy-sdd/en/" → "/en/"
  }
  if (pathname === BASE) {
    return '/';
  }
  return pathname;
}

export function getLangFromUrl(url: URL): Lang {
  const stripped = stripBase(url.pathname);
  const [, lang] = stripped.split('/');
  if (lang in ui) return lang as Lang;
  return defaultLang;
}

export function useTranslations(lang: Lang) {
  return function t(key: TranslationKey): string {
    return ui[lang][key] || ui[defaultLang][key] || key;
  };
}

export function getLocalizedPath(path: string, lang: Lang): string {
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;

  // Check if path already has a language prefix
  const pathParts = cleanPath.split('/');
  if (pathParts[0] in ui) {
    pathParts[0] = lang;
    return BASE + '/' + pathParts.join('/');
  }

  return `${BASE}/${lang}/${cleanPath}`;
}

export function getPathWithoutLang(path: string): string {
  const stripped = stripBase(path);
  const cleanPath = stripped.startsWith('/') ? stripped.slice(1) : stripped;
  const pathParts = cleanPath.split('/');

  if (pathParts[0] in ui) {
    return '/' + pathParts.slice(1).join('/');
  }

  return '/' + cleanPath;
}