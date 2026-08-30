import zh from './zh';
import en from './en';

type DeepStringify<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepStringify<T[K]>;
};

export type Translations = DeepStringify<typeof zh>;

const translations: Record<string, Translations> = { zh, en };

let currentLang: string = 'zh';

export function setLanguage(lang: 'zh' | 'en') {
  if (translations[lang]) {
    currentLang = lang;
  }
}

export function getLanguage(): string {
  return currentLang;
}

export function t(key: string): string {
  const keys = key.split('.');
  let result: unknown = translations[currentLang] || zh;
  for (const k of keys) {
    if (result && typeof result === 'object' && k in result) {
      result = (result as Record<string, unknown>)[k];
    } else {
      return key;
    }
  }
  return typeof result === 'string' ? result : key;
}

export { zh };
