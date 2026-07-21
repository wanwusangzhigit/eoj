import type { SiteConfig } from '../site-config';

declare const SITE_CONFIG: Partial<SiteConfig> | undefined;

const defaults: SiteConfig = {
  site: {
    name: 'OJ System',
    short_name: 'OJ',
    description: 'Online Judge',
    icon: 'default',
    favicon: '/favicon.svg',
    theme: 'default',
  },
  footer: {
    enabled: true,
    text: '',
    links: [],
  },
  login: {
    hero_title: '',
    hero_subtitle: '',
    show_github: true,
    show_cpoauth: true,
  },
  home: {
    title: '',
  },
  contact: {
    email: '',
  },
};

function deepMerge(target: any, source: any): any {
  if (!source) return target;
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else if (source[key] !== undefined && source[key] !== null) {
      result[key] = source[key];
    }
  }
  return result;
}

let cachedConfig: SiteConfig | null = null;

export function getSiteConfig(): SiteConfig {
  if (cachedConfig) return cachedConfig;
  try {
    const raw = typeof SITE_CONFIG !== 'undefined' ? SITE_CONFIG : {};
    cachedConfig = deepMerge(defaults, raw) as SiteConfig;
  } catch {
    cachedConfig = defaults;
  }
  return cachedConfig!;
}

export function useSiteConfig(): SiteConfig {
  return getSiteConfig();
}
