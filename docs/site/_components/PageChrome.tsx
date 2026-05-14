import { type CSSProperties, type ReactNode, useEffect } from 'react';
import './page-chrome.css';

export function PageHero({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <header className="v-page-hero">
      <p className="v-page-hero__eyebrow">{eyebrow}</p>
      <h1 className="v-page-hero__title">{title}</h1>
      {sub ? <p className="v-page-hero__sub">{sub}</p> : null}
      <div className="v-page-hero__divider" aria-hidden="true" />
    </header>
  );
}

/**
 * Slugify a heading string for use as an HTML id (and #anchor target).
 * Mirrors the kebab-case scheme rspress's markdown extractor uses for
 * `## My Heading` so deep-links like `/overview#our-position` work the
 * same way regardless of whether the heading is rendered from markdown
 * or from this React component.
 */
function slugifyHeading(value: ReactNode): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function Section({
  eyebrow,
  heading,
  id,
  children,
}: {
  eyebrow: string;
  heading: ReactNode;
  /** Optional explicit id; otherwise derived from `heading` */
  id?: string;
  children?: ReactNode;
}) {
  const headingId = id ?? slugifyHeading(heading);
  return (
    <section className="v-section">
      <p className="v-section__eyebrow">{eyebrow}</p>
      {/* `rp-toc-include` + an id are what rspress's outline component
          (`useDynamicToc` → `.rspress-doc h2.rp-toc-include`) needs to
          pick this up into the right-side TOC. */}
      <h2 id={headingId} className="v-section__heading rp-toc-include">
        {heading}
      </h2>
      {children ? <div className="v-section__body">{children}</div> : null}
    </section>
  );
}

type KpiAccent = 'teal' | 'violet' | 'coral';

export function KpiStrip({
  items,
}: {
  items: { value: string; label: string; accent?: KpiAccent }[];
}) {
  return (
    <div className="v-kpi-strip">
      {items.map((item, i) => (
        <div key={i}>
          <div
            className={`v-kpi__value v-kpi__value--${item.accent ?? 'teal'}`}
          >
            {item.value}
          </div>
          <div className="v-kpi__label">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

export function CompareCards({
  others,
  highlight,
}: {
  others: { name: string; tagline: string }[];
  highlight: { name: string; tagline: string };
}) {
  return (
    <div className="v-compare">
      <div className="v-compare__row">
        {others.map((card, i) => (
          <div key={i} className="v-compare__card">
            <div className="v-compare__card-name">{card.name}</div>
            <div className="v-compare__card-tagline">{card.tagline}</div>
          </div>
        ))}
      </div>
      <div className="v-compare__highlight">
        <div className="v-compare__highlight-name">{highlight.name}</div>
        <div className="v-compare__highlight-tagline">{highlight.tagline}</div>
      </div>
    </div>
  );
}

type LayerAccent = 'teal' | 'violet' | 'coral';

export function LayerCards({
  layers,
}: {
  layers: {
    pill: string;
    accent: LayerAccent;
    title: string;
    body: ReactNode;
    runtimes: string;
    /** Optional pictographic icon shown above the pill (e.g. a lucide-react icon). */
    icon?: ReactNode;
  }[];
}) {
  return (
    <div className="v-layers">
      {layers.map((layer, i) => (
        <article key={i} className={`v-layer v-layer--${layer.accent}`}>
          {layer.icon ? (
            <div
              className={`v-layer__icon v-layer__icon--${layer.accent}`}
              aria-hidden="true"
            >
              {layer.icon}
            </div>
          ) : null}
          <span className={`v-layer__pill v-layer__pill--${layer.accent}`}>
            {layer.pill}
          </span>
          <h3 className="v-layer__title">{layer.title}</h3>
          <p className="v-layer__body">{layer.body}</p>
          <div className="v-layer__runtimes">{layer.runtimes}</div>
        </article>
      ))}
    </div>
  );
}

/**
 * Architecture-page comparison strip. Each column is one of the three
 * execution layers; each row is one attribute (起動 / 向くバグ / 届かない
 * こと / ランタイム). Optimised for at-a-glance comparison — narrower than
 * the deep-dive Sections that follow it on the architecture page.
 *
 * Distinct from LayerCards (overview page): LayerCards is a tagline-level
 * 3-card row, LayerMatrix is a row-per-attribute scannable grid that pays
 * off when the reader has already decided to compare in detail.
 */
export function LayerMatrix({
  rowLabels,
  layers,
}: {
  /** Row label for each attribute, top-to-bottom (length must match layers[*].cells). */
  rowLabels: string[];
  /** One column per layer. Cells align positionally with rowLabels. */
  layers: {
    pill: string;
    accent: LayerAccent;
    title: string;
    cells: ReactNode[];
  }[];
}) {
  return (
    <div
      className="v-layer-matrix"
      style={
        {
          '--v-layer-matrix-cols': layers.length,
        } as CSSProperties
      }
    >
      <div className="v-layer-matrix__head">
        <div className="v-layer-matrix__row-label" aria-hidden="true" />
        {layers.map((layer, i) => (
          <div key={i} className="v-layer-matrix__col-head">
            <span className={`v-layer__pill v-layer__pill--${layer.accent}`}>
              {layer.pill}
            </span>
            <h3 className="v-layer-matrix__col-title">{layer.title}</h3>
          </div>
        ))}
      </div>
      {rowLabels.map((rowLabel, r) => (
        <div key={r} className="v-layer-matrix__row">
          <div className="v-layer-matrix__row-label">{rowLabel}</div>
          {layers.map((layer, c) => (
            <div key={c} className="v-layer-matrix__cell">
              {layer.cells[r]}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Architecture-page deep-dive section for a single layer. Replaces the
 * Section + h3 hand-rolling that the architecture page previously did
 * per layer; gives every layer the same 4-row structure
 * (向くバグ / 起動 or 使い方 / 届かないこと / ランタイム or 例) so the
 * reader can compare in parallel without re-orienting.
 *
 * Two-column on wide screens (left = explanation, right = examples /
 * runtimes), single-column on mobile.
 */
export function LayerSection({
  pill,
  accent,
  eyebrow,
  heading,
  intro,
  cellLabels,
  fits,
  startup,
  cantReach,
  runtimes,
}: {
  pill: string;
  accent: LayerAccent;
  eyebrow: string;
  heading: ReactNode;
  intro: ReactNode;
  /** Locale-specific labels for the four cells, top-left → bottom-right. */
  cellLabels: {
    fits: string;
    startup: string;
    cantReach: string;
    runtimes: string;
  };
  fits: ReactNode;
  /** "Startup time" for L1; "How to use it" prose for L2/L3 — same slot. */
  startup: ReactNode;
  cantReach: ReactNode;
  /** "Supported runtimes" or "Examples in the catalogue" — same slot. */
  runtimes: ReactNode;
}) {
  const headingId = slugifyHeading(heading);
  return (
    <section className={`v-layer-section v-layer-section--${accent}`}>
      <div className="v-layer-section__head">
        <span className={`v-layer__pill v-layer__pill--${accent}`}>{pill}</span>
        <p className="v-layer-section__eyebrow">{eyebrow}</p>
        <h2 id={headingId} className="v-layer-section__heading rp-toc-include">
          {heading}
        </h2>
        <div className="v-layer-section__intro">{intro}</div>
      </div>
      <div className="v-layer-section__grid">
        <div className="v-layer-section__cell">
          <h3 className="v-layer-section__cell-heading">{cellLabels.fits}</h3>
          <div className="v-layer-section__cell-body">{fits}</div>
        </div>
        <div className="v-layer-section__cell">
          <h3 className="v-layer-section__cell-heading">
            {cellLabels.startup}
          </h3>
          <div className="v-layer-section__cell-body">{startup}</div>
        </div>
        <div className="v-layer-section__cell">
          <h3 className="v-layer-section__cell-heading">
            {cellLabels.cantReach}
          </h3>
          <div className="v-layer-section__cell-body">{cantReach}</div>
        </div>
        <div className="v-layer-section__cell">
          <h3 className="v-layer-section__cell-heading">
            {cellLabels.runtimes}
          </h3>
          <div className="v-layer-section__cell-body">{runtimes}</div>
        </div>
      </div>
    </section>
  );
}

/**
 * Persona-route grid for "what you came here to do" cards. Used on
 * the overview / guide-map / spec pages — distinct from `LayerCards`
 * (which is about the three execution layers, not reader intent).
 *
 * Layout:
 *   - 1 column on mobile.
 *   - For 3 cards on desktop: 1×3 strip.
 *   - For 4 cards on desktop: 2×2 grid (1×4 squeezes the cards too
 *     narrow inside the rspress doc-content max-width).
 *
 * Each card optionally carries a pictographic icon (`icon`, e.g. a
 * lucide-react icon) so the visual scan can pick up the route without
 * reading the kicker.
 */
export function RouteCards({
  cards,
}: {
  cards: {
    kicker: string;
    title: string;
    body: ReactNode;
    href: string;
    /** Optional pictographic icon (e.g. a lucide-react icon). */
    icon?: ReactNode;
  }[];
}) {
  // 4-card layouts use a 2-column grid (rendered 2×2). 3-card and
  // smaller stay at their natural column count. Larger counts fall
  // back to the natural count too — a future caller can revisit.
  const desktopCols = cards.length === 4 ? 2 : cards.length;
  return (
    <div
      className="v-routes"
      style={
        {
          '--v-routes-cols': desktopCols,
        } as CSSProperties
      }
    >
      {cards.map((card, i) => (
        <a key={i} className="v-routes__card" href={card.href}>
          {card.icon ? (
            <div className="v-routes__icon" aria-hidden="true">
              {card.icon}
            </div>
          ) : null}
          <span className="v-routes__kicker">{card.kicker}</span>
          <h3 className="v-routes__title">{card.title}</h3>
          <p className="v-routes__body">{card.body}</p>
          <span className="v-routes__cta" aria-hidden="true">
            →
          </span>
        </a>
      ))}
    </div>
  );
}

/**
 * Short inline CTA designed to sit between two sections of the same
 * page — lighter weight than `NextCta` (which closes the page) and
 * narrower than the full-width `Callout`. Used to nudge readers from
 * the deep-dive content above to the live example below without
 * forcing them to scroll to the page footer.
 */
export function InlineCta({
  text,
  link,
}: {
  text: ReactNode;
  link: { label: ReactNode; href: string };
}) {
  // Rendered as a <div>, NOT a <p>: rspress's `.v-section__body p`
  // rule (specificity 0,1,1) sets margin-top:0 which would beat
  // `.v-inline-cta` (specificity 0,1,0) and crush the spacing this
  // component is meant to provide between sibling sections. Using a
  // <div> sidesteps the p-rule and keeps `.v-inline-cta`'s
  // margin-top in effect.
  return (
    <div className="v-inline-cta">
      <span className="v-inline-cta__text">{text}</span>
      <a className="v-inline-cta__link" href={link.href}>
        {link.label} <span aria-hidden="true">→</span>
      </a>
    </div>
  );
}

export function NumberedList({
  items,
}: {
  items: { lead: string; body: ReactNode }[];
}) {
  return (
    <div className="v-numlist">
      {items.map((item, i) => (
        <div key={i} className="v-numlist__item">
          <div className="v-numlist__num">{String(i + 1).padStart(2, '0')}</div>
          <div>
            <span className="v-numlist__lead">{item.lead}</span>
            <p className="v-numlist__body">{item.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Callout({ children }: { children: ReactNode }) {
  // No wrapping <p> here: MDX wraps the children in a paragraph component
  // already, and a hand-written <p> on top produces a hydration-breaking
  // <p><p>...</p></p> nest. CSS rule `.v-callout p` still matches.
  return <blockquote className="v-callout">{children}</blockquote>;
}

export function NextCta({
  eyebrow,
  heading,
  sub,
  primary,
  ghost,
}: {
  eyebrow: string;
  heading: ReactNode;
  sub: ReactNode;
  primary: { label: ReactNode; href: string };
  ghost?: { label: ReactNode; href: string };
}) {
  return (
    <section className="v-next-cta">
      <div className="v-next-cta__inner">
        <p className="v-next-cta__eyebrow">{eyebrow}</p>
        <h2 className="v-next-cta__heading">{heading}</h2>
        <p className="v-next-cta__sub">{sub}</p>
        <div className="v-next-cta__buttons">
          <a
            className="v-next-cta__btn v-next-cta__btn--primary"
            href={primary.href}
          >
            {primary.label}
          </a>
          {ghost ? (
            <a
              className="v-next-cta__btn v-next-cta__btn--ghost"
              href={ghost.href}
            >
              {ghost.label}
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function BottomNote({ text, href }: { text: string; href: string }) {
  return (
    <a className="v-bottom-note" href={href} target="_blank" rel="noreferrer">
      {text}
    </a>
  );
}

/**
 * Trigger rspress's right-side TOC (Outline) to re-scan headings on every
 * Page mount. rspress's `useDynamicToc` hook (in @rspress/core/dist/theme/
 * hooks/useDynamicToc.js) installs a MutationObserver on `.rspress-doc`
 * that ONLY checks direct children of added/removed nodes for h2/h3/h4
 * tags. Our `<Section>` components keep the heading nested two levels deep
 * (`<section> > <h2>`), so SPA navigation between two PageChrome pages
 * leaves `headers.current` populated with the previous page's headings.
 *
 * The fix: append+remove a hidden h2.rp-toc-include directly under
 * `.rspress-doc` after the new page mounts. The hidden node passes the
 * observer's direct-child check, fires `updateHeaders`, which re-scans the
 * full DOM (now containing the new page's visible Section h2s) and
 * refreshes the outline. The probe itself is filtered by the hook's
 * `isElementVisible` check (display:none) so it never appears in the TOC.
 */
function useRefreshOutlineOnMount() {
  useEffect(() => {
    const docRoot = document.querySelector('.rspress-doc');
    if (!docRoot) return;
    const probe = document.createElement('h2');
    probe.className = 'rp-toc-include';
    probe.style.display = 'none';
    docRoot.appendChild(probe);
    const t = window.setTimeout(() => probe.remove(), 50);
    return () => {
      window.clearTimeout(t);
      if (probe.isConnected) probe.remove();
    };
  }, []);
}

export function Page({ children }: { children: ReactNode }) {
  useRefreshOutlineOnMount();
  return <main className="v-page">{children}</main>;
}
