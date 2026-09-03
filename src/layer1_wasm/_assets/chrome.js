import {
  FAVICONS,
  FOOTER_MESSAGE_HTML,
  GH_REPO,
  NAV_ITEMS,
  SITE_BASE,
} from './chrome-data.js';
import { localeCounterpartPath } from './locale.js';

(function injectFavicons() {
  for (const spec of FAVICONS) {
    if (document.head.querySelector(`link[rel="${spec.rel}"][sizes="${spec.sizes}"]`)) continue;
    const link = document.createElement('link');
    for (const [k, v] of Object.entries(spec)) link.setAttribute(k, v);
    document.head.appendChild(link);
  }
})();

const THEME_KEY = 'rspress-theme-appearance';

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

window.addEventListener('storage', (e) => {
  if (e.key === THEME_KEY) applyTheme();
});

const sun =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
const moon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const github =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12.02c0 5.09 3.29 9.4 7.86 10.93.58.11.79-.25.79-.55 0-.27-.01-.99-.02-1.94-3.2.69-3.87-1.54-3.87-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18.91-.25 1.89-.38 2.86-.38.97 0 1.95.13 2.86.38 2.18-1.49 3.14-1.18 3.14-1.18.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.36-5.25 5.65.41.36.78 1.06.78 2.14 0 1.55-.01 2.79-.01 3.17 0 .31.21.67.79.55 4.57-1.53 7.86-5.84 7.86-10.93C23.5 5.65 18.35.5 12 .5z"/></svg>';

const LANG = document.documentElement.lang === 'ja' ? 'ja' : 'en';

const CHROME_STRINGS = {
  en: {
    brandAria: 'Vivarium home',
    navAria: 'Site navigation',
    githubAria: 'GitHub repository',
    themeAria: 'Toggle theme',
    drawerAria: 'Bug context',
    drawerCloseAria: 'Close bug context',
    initialising: 'Initialising\u2026',
    complete: 'Reproduction complete.',
    switchTo: '\u65e5\u672c\u8a9e',
  },
  ja: {
    brandAria: 'Vivarium \u30db\u30fc\u30e0',
    navAria: '\u30b5\u30a4\u30c8\u30ca\u30d3\u30b2\u30fc\u30b7\u30e7\u30f3',
    githubAria: 'GitHub \u30ea\u30dd\u30b8\u30c8\u30ea',
    themeAria: '\u30c6\u30fc\u30de\u3092\u5207\u308a\u66ff\u3048\u308b',
    drawerAria: 'bug \u306e\u80cc\u666f',
    drawerCloseAria: 'bug \u306e\u80cc\u666f\u3092\u9589\u3058\u308b',
    initialising: '\u521d\u671f\u5316\u4e2d\u2026',
    complete: '\u518d\u73fe\u5b8c\u4e86\u3002',
    switchTo: 'English',
  },
};

const T = CHROME_STRINGS[LANG];

function injectChrome() {
  applyTheme();

  const nav = document.createElement('header');
  nav.className = 'vh-topnav';

  const navLinks = NAV_ITEMS[LANG].map(
    (it) => `<a class="vh-topnav__link" href="${it.link}">${it.text}</a>`,
  ).join('');

  const counterpart = localeCounterpartPath(location.pathname, SITE_BASE);
  const langHref =
    counterpart ?? (LANG === 'ja' ? `${SITE_BASE}` : `${SITE_BASE}ja/`);
  const langText = T.switchTo;
  const langCode = LANG === 'ja' ? 'en' : 'ja';

  nav.innerHTML = `
    <div class="vh-topnav__left">
      <a class="vh-topnav__brand-link" href="${SITE_BASE}" aria-label="${T.brandAria}">Vivarium</a>
    </div>
    <nav class="vh-topnav__menu" aria-label="${T.navAria}">
      ${navLinks}
    </nav>
    <div class="vh-topnav__right">
      <a class="vh-topnav__link vh-topnav__lang" hreflang="${langCode}" lang="${langCode}" rel="alternate" href="${langHref}">${langText}</a>
      <a class="vh-topnav__icon" href="${GH_REPO}" target="_blank" rel="noreferrer" aria-label="${T.githubAria}">${github}</a>
      <button class="vh-topnav__theme" type="button" aria-label="${T.themeAria}">${moon}</button>
    </div>
  `;
  document.body.insertBefore(nav, document.body.firstChild);

  const outputEl = document.querySelector('#output');
  if (outputEl?.parentElement) {
    const outputCol = outputEl.parentElement;
    outputCol.classList.add('vh-output-section');
    outputEl.classList.add('vh-output');

    const colH2 = outputCol.querySelector(':scope > h2');
    if (colH2 && colH2.parentElement === outputCol) {
      const head = document.createElement('div');
      head.className = 'vh-runner__head';
      outputCol.insertBefore(head, colH2);
      head.appendChild(colH2);
    }

    const progress = document.createElement('div');
    progress.className = 'vh-progress';
    progress.innerHTML = `
      <div class="vh-progress__bar"><div class="vh-progress__fill"></div></div>
      <div class="vh-progress__row">
        <span class="vh-progress__label">${T.initialising}</span>
        <span class="vh-progress__bytes"></span>
      </div>
    `;
    outputEl.parentElement.insertBefore(progress, outputEl);
  }

  const footer = document.createElement('footer');
  footer.className = 'vh-footer';
  footer.innerHTML = `
    <p class="vh-footer__msg">
      ${FOOTER_MESSAGE_HTML.replace('<a ', '<a target="_blank" rel="noreferrer" ')}
    </p>
  `;
  document.body.appendChild(footer);

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
    el.classList.add('is-done');
    out?.classList.add('is-revealed');
    setTimeout(() => el.remove(), 600);
  }
}

document.addEventListener('vh-progress', (e) => {
  const d = e?.detail || {};
  if (d.stage === 'done') {
    setProgress(100, T.complete, '');
    hideProgress();
    return;
  }
  setProgress(d.pct ?? 0, d.label ?? '', d.bytes ?? '');
});

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;

  navigator.serviceWorker
    .register('../_assets/sw.js', { scope: '/vivarium/repro/' })
    .catch((err) => {
      console.warn('[vivarium] service worker registration failed:', err);
    });
}

const drawerCloseSvg =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

function injectDescriptionDrawer() {
  const tpl = document.getElementById('bug-context');
  const triggers = document.querySelectorAll(
    'button[data-vh-action="open-drawer"]',
  );
  if (!tpl || triggers.length === 0) return;

  const wash = document.createElement('div');
  wash.className = 'vh-drawer-wash';
  wash.setAttribute('aria-hidden', 'true');

  const drawer = document.createElement('aside');
  drawer.className = 'vh-drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', T.drawerAria);
  drawer.setAttribute('aria-hidden', 'true');
  drawer.tabIndex = -1;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'vh-drawer__close';
  close.setAttribute('aria-label', T.drawerCloseAria);
  close.innerHTML = drawerCloseSvg;
  drawer.appendChild(close);

  drawer.appendChild(tpl.content.cloneNode(true));

  document.body.appendChild(wash);
  document.body.appendChild(drawer);

  let lastTrigger = null;

  function open(triggerEl) {
    lastTrigger = triggerEl ?? null;
    drawer.classList.add('is-open');
    wash.classList.add('is-visible');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('vh-drawer-open');
    for (const t of triggers) t.setAttribute('aria-expanded', 'true');
    setTimeout(() => close.focus(), 50);
  }

  function closeDrawer() {
    drawer.classList.remove('is-open');
    wash.classList.remove('is-visible');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('vh-drawer-open');
    for (const t of triggers) t.setAttribute('aria-expanded', 'false');
    if (lastTrigger && typeof lastTrigger.focus === 'function') {
      lastTrigger.focus();
    }
    lastTrigger = null;
  }

  triggers.forEach((t) => {
    t.setAttribute('aria-expanded', 'false');
    t.setAttribute('aria-controls', 'vh-drawer-body');
    t.addEventListener('click', (ev) => {
      ev.preventDefault();
      open(t);
    });
  });

  close.addEventListener('click', () => closeDrawer());
  wash.addEventListener('click', () => closeDrawer());
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && drawer.classList.contains('is-open')) {
      ev.preventDefault();
      closeDrawer();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    injectChrome();
    injectDescriptionDrawer();
    registerServiceWorker();
  });
} else {
  injectChrome();
  injectDescriptionDrawer();
  registerServiceWorker();
}
