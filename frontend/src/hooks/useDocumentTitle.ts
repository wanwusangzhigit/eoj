import { useEffect } from 'react';
import { t } from '../i18n';
import { getSiteConfig } from './useSiteConfig';

const BASE_TITLE = getSiteConfig().site.name;

export function useDocumentTitle(title?: string, metaDescription?: string) {
  useEffect(() => {
    if (title) {
      document.title = `${title} - ${BASE_TITLE}`;
    } else {
      document.title = BASE_TITLE;
    }

    // Lightweight per-page meta description for SEO/social snippets.
    let prevDescription: string | null = null;
    if (metaDescription) {
      let metaEl = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
      prevDescription = metaEl?.getAttribute('content') || null;
      if (!metaEl) {
        metaEl = document.createElement('meta');
        metaEl.name = 'description';
        document.head.appendChild(metaEl);
      }
      metaEl.setAttribute('content', metaDescription);
    }

    return () => {
      document.title = BASE_TITLE;
      if (metaDescription) {
        const el = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
        if (el) {
          if (prevDescription) el.setAttribute('content', prevDescription);
          else el.remove();
        }
      }
    };
  }, [title, metaDescription]);
}

export function useDocumentTitleKey(key?: string) {
  const title = key ? t(key) : undefined;
  useDocumentTitle(title);
}
