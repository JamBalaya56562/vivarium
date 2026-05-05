import { useEffect, type ReactNode } from 'react';
import './page-chrome.css';

/* ----------------------------- PageHero ----------------------------- */

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

/* ----------------------------- Section ----------------------------- */

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

/* ----------------------------- KpiStrip ----------------------------- */

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
          <div className={`v-kpi__value v-kpi__value--${item.accent ?? 'teal'}`}>
            {item.value}
          </div>
          <div className="v-kpi__label">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

/* ----------------------------- CompareCards ----------------------------- */

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

/* ----------------------------- LayerCards ----------------------------- */

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
  }[];
}) {
  return (
    <div className="v-layers">
      {layers.map((layer, i) => (
        <article key={i} className="v-layer">
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

/* ----------------------------- NumberedList ----------------------------- */

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

/* ----------------------------- Callout ----------------------------- */

export function Callout({ children }: { children: ReactNode }) {
  return (
    <blockquote className="v-callout">
      <p>{children}</p>
    </blockquote>
  );
}

/* ----------------------------- NextCta ----------------------------- */

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
          <a className="v-next-cta__btn v-next-cta__btn--primary" href={primary.href}>
            {primary.label}
          </a>
          {ghost ? (
            <a className="v-next-cta__btn v-next-cta__btn--ghost" href={ghost.href}>
              {ghost.label}
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- BottomNote ----------------------------- */

export function BottomNote({
  text,
  href,
}: {
  text: string;
  href: string;
}) {
  return (
    <a
      className="v-bottom-note"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {text}
    </a>
  );
}

/* ----------------------------- Page wrapper ----------------------------- */

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
