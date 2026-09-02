// Locale plumbing for the reproduction-page runtime.
//
// A reproduction page is plain static HTML with no router and no
// framework, so there is nothing to thread a locale through. The one
// signal that is always present and always correct is the document's own
// `<html lang>`, which `docs/scripts/generate-repro-i18n.ts` sets to
// `ja` on the generated Japanese page. Reading it here keeps every
// string table in `_shared/` free of any locale wiring of its own.
//
// The merge shape deliberately matches the one `path_a.ts` established:
// `{ ...DEFAULT_STRINGS, ...DEFAULT_STRINGS_JA }`, with the Japanese
// table typed `Partial<T>`. A half-finished translation therefore
// degrades to English per key rather than rendering `undefined`.

export type Lang = 'en' | 'ja';

/**
 * Locale of the page currently being rendered.
 *
 * Defaults to English outside a browser (the Playwright helpers import
 * these modules in Node for type-checking) and for any value other than
 * `ja` — there is exactly one translated locale today, and an unknown
 * one should fall back rather than throw.
 */
export function pageLang(): Lang {
  if (typeof document === 'undefined') return 'en';
  return document.documentElement.lang === 'ja' ? 'ja' : 'en';
}

/** Merge a Japanese overlay onto the English table for the current page. */
export function pick<T extends object>(en: T, ja: Partial<T>): T {
  return pageLang() === 'ja' ? { ...en, ...ja } : en;
}
