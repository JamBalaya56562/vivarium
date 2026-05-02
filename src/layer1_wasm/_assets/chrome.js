// Vivarium reproduction page chrome — nav, footer, theme toggle, progress
// bar UI, and service-worker registration. Imported as a side-effect from
// `_shared/loader.ts` (Layer 1) and `_layer2-shared/layer2.js` (Layer 2),
// so every reproduction page picks it up automatically.
//
// Plain JS (no TypeScript build) so Layer 2 — which has no tsc step —
// can also import it without a compile dance.

const THEME_KEY = 'rspress-theme-appearance';

// ── Theme helpers ────────────────────────────────────────────────────────

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function applyTheme(value) {
  const stored = value ?? getStoredTheme();
  const prefers = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = !stored || stored === 'auto' ? prefers : stored === 'dark';
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.classList.toggle('rp-dark', isDark);
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
}

function setStoredTheme(value) {
  try {
    if (value === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, value);
  } catch {}
  applyTheme(value);
}

// Sync across tabs: docs site flips theme → repro tab follows.
window.addEventListener('storage', (e) => {
  if (e.key === THEME_KEY) applyTheme();
});

// ── Inline SVG icons ────────────────────────────────────────────────────

const sun = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
const moon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const github = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12.02c0 5.09 3.29 9.4 7.86 10.93.58.11.79-.25.79-.55 0-.27-.01-.99-.02-1.94-3.2.69-3.87-1.54-3.87-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18.91-.25 1.89-.38 2.86-.38.97 0 1.95.13 2.86.38 2.18-1.49 3.14-1.18 3.14-1.18.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.36-5.25 5.65.41.36.78 1.06.78 2.14 0 1.55-.01 2.79-.01 3.17 0 .31.21.67.79.55 4.57-1.53 7.86-5.84 7.86-10.93C23.5 5.65 18.35.5 12 .5z"/></svg>';

// rspress's nav links — keep in sync with docs/docs/_nav.json. Hardcoded
// here so this script doesn't need to fetch a JSON file before the page
// can paint its chrome.
const NAV_ITEMS = [
  { text: 'Vision', link: '/vivarium/vision' },
  { text: 'Roadmap', link: '/vivarium/roadmap' },
  { text: 'Architecture', link: '/vivarium/architecture' },
  { text: 'Spec', link: '/vivarium/spec/' },
  { text: 'AI workflow', link: '/vivarium/ai-workflow' },
  { text: 'Reproductions', link: '/vivarium/repro/' },
  { text: '日本語', link: '/vivarium/ja/' },
];

const GH_REPO = 'https://github.com/aletheia-works/vivarium';

// ── Inject nav, progress bar, footer ───────────────────────────────────

function injectChrome() {
  applyTheme();

  // Top nav — mirrors rspress's `<header class="rp-nav">` layout: brand
  // on the left, nav links + GitHub icon + theme toggle on the right.
  // Same content as the docs site so visitors can hop between any
  // reproduction page and the rest of the site without going back.
  const nav = document.createElement('header');
  nav.className = 'vh-topnav';

  const navLinks = NAV_ITEMS.map(
    (it) =>
      `<a class="vh-topnav__link" href="${it.link}">${it.text}</a>`,
  ).join('');

  nav.innerHTML = `
    <div class="vh-topnav__left">
      <a class="vh-topnav__brand-link" href="/vivarium/" aria-label="Vivarium home">Vivarium</a>
    </div>
    <nav class="vh-topnav__menu" aria-label="Site navigation">
      ${navLinks}
    </nav>
    <div class="vh-topnav__right">
      <a class="vh-topnav__icon" href="${GH_REPO}" target="_blank" rel="noreferrer" aria-label="GitHub repository">${github}</a>
      <button class="vh-topnav__theme" type="button" aria-label="Toggle theme">${moon}</button>
    </div>
  `;
  document.body.insertBefore(nav, document.body.firstChild);

  // Progress bar slot — placed inside the Output section, in front of the
  // `<pre id="output">`. While loading, the pre is hidden and the
  // progress occupies its visual space; when the run finishes, the
  // progress fades and the pre becomes visible. Both elements stay in
  // the DOM throughout, so removing the progress at the end doesn't
  // cause a layout shift (the section's min-height is set via CSS to
  // accommodate either element comfortably).
  const outputEl = document.querySelector('#output');
  if (outputEl?.parentElement) {
    outputEl.parentElement.classList.add('vh-output-section');
    outputEl.classList.add('vh-output');

    const progress = document.createElement('div');
    progress.className = 'vh-progress';
    progress.innerHTML = `
      <div class="vh-progress__bar"><div class="vh-progress__fill"></div></div>
      <div class="vh-progress__row">
        <span class="vh-progress__label">Initialising…</span>
        <span class="vh-progress__bytes"></span>
      </div>
    `;
    outputEl.parentElement.insertBefore(progress, outputEl);
  }

  // Footer — matches the docs site (themeConfig.footer.message): a
  // centred single line of light copy, no big wordmark / link grid.
  const footer = document.createElement('footer');
  footer.className = 'vh-footer';
  footer.innerHTML = `
    <p class="vh-footer__msg">
      Apache License 2.0 · part of
      <a href="https://github.com/aletheia-works" target="_blank" rel="noreferrer">aletheia-works</a>
    </p>
  `;
  document.body.appendChild(footer);

  // Theme toggle behaviour
  const toggleBtn = nav.querySelector('.vh-topnav__theme');
  function refreshIcon() {
    const dark = document.documentElement.classList.contains('dark');
    if (toggleBtn) toggleBtn.innerHTML = dark ? sun : moon;
  }
  refreshIcon();
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const dark = document.documentElement.classList.contains('dark');
      setStoredTheme(dark ? 'light' : 'dark');
      refreshIcon();
    });
  }
}

// ── Progress bar driver ─────────────────────────────────────────────────

function setProgress(pct, label, bytes) {
  const fill = document.querySelector('.vh-progress__fill');
  const lab = document.querySelector('.vh-progress__label');
  const byt = document.querySelector('.vh-progress__bytes');
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  if (lab && label) lab.textContent = label;
  if (byt && bytes != null) byt.textContent = bytes;
}

function hideProgress() {
  const el = document.querySelector('.vh-progress');
  const out = document.querySelector('.vh-output');
  if (el) {
    // Trigger the cross-fade: progress fades out, output fades in. They
    // share the same grid cell (see .vh-output-section in style.css), so
    // no layout shift when the progress unmounts.
    el.classList.add('is-done');
    out?.classList.add('is-revealed');
    setTimeout(() => el.remove(), 600);
  }
}

document.addEventListener('vh-progress', (e) => {
  const d = (e && e.detail) || {};
  if (d.stage === 'done') {
    setProgress(100, 'Reproduction complete.', '');
    hideProgress();
    return;
  }
  setProgress(d.pct ?? 0, d.label ?? '', d.bytes ?? '');
});

// ── Service worker registration (Pyodide cache for repeat visits) ──────

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;

  // Path is relative to /repro/<slug>/. The SW lives at
  // /vivarium/repro/_assets/sw.js (per-layer copy under each layer's
  // _assets/ tree). Scope is the whole /repro/ tree so any reproduction
  // page benefits from the cached Pyodide; this requires the
  // `Service-Worker-Allowed` header which the rspress dev middleware
  // sets for any file ending in `sw.js`, regardless of SW location.
  navigator.serviceWorker
    .register('../_assets/sw.js', { scope: '/vivarium/repro/' })
    .catch((err) => {
      console.warn('[vivarium] service worker registration failed:', err);
    });
}

// ── Bootstrap ───────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    injectChrome();
    registerServiceWorker();
  });
} else {
  injectChrome();
  registerServiceWorker();
}
