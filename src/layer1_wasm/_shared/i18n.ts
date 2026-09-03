export type Lang = 'en' | 'ja';

export function pageLang(): Lang {
  if (typeof document === 'undefined') return 'en';
  return document.documentElement.lang === 'ja' ? 'ja' : 'en';
}

export function pick<T extends object>(en: T, ja: Partial<T>): T {
  return pageLang() === 'ja' ? { ...en, ...ja } : en;
}
