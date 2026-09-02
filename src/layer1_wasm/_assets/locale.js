// Locale-counterpart URL derivation for the reproduction-page chrome.
//
// Split out of chrome.js purely so `bun test` can exercise it:
// chrome.js reads `document.documentElement.lang` at module scope, so
// importing it outside a browser throws. This module touches no DOM.
//
// The bug it exists to prevent: the locale switcher used to hardcode
// `${SITE_BASE}ja/`, so pressing it on a reproduction page dropped the
// visitor on the docs top page instead of the same recipe's other
// locale.

/**
 * Map a reproduction-page pathname to the same recipe's other locale.
 *
 * Recipe URLs are exactly `repro/<project>/<issue>/` — the same shape
 * `resolveReproFile()` in docs/scripts/repro-dev-middleware.ts treats as
 * a recipe, as opposed to `_`-prefixed shared scaffolding, which is
 * English-only.
 *
 * Returns `null` when the pathname is not a recipe page, which the
 * caller reads as "no counterpart exists, fall back to the site root".
 * Two real cases hit that branch: `_shared/_test/`, the smoke page that
 * also loads this chrome and ships no translation, and the per-layer
 * Playwright static servers, which serve recipes at `/<slug>/` rather
 * than under SITE_BASE.
 *
 * @param {string} pathname  `location.pathname` of the current page.
 * @param {string} siteBase  Site base with a trailing slash, e.g. "/vivarium/".
 * @returns {string | null}  Absolute path of the counterpart page.
 */
export function localeCounterpartPath(pathname, siteBase) {
  if (!pathname.startsWith(siteBase)) return null;

  let rest = pathname.slice(siteBase.length);
  const isJa = rest === 'ja' || rest.startsWith('ja/');
  if (isJa) rest = rest.slice(3);

  // Trailing slash and an explicit `index.html` are both accepted and
  // normalised away, so the emitted href is always slash-terminated.
  const m = /^repro\/([^_/][^/]*)\/([^/]+)(?:\/(?:index\.html)?)?$/.exec(rest);
  if (!m) return null;

  const tail = `repro/${m[1]}/${m[2]}/`;
  return isJa ? `${siteBase}${tail}` : `${siteBase}ja/${tail}`;
}
