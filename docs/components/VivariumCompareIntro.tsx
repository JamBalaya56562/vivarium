import { ClipboardPaste, Link2, Upload } from 'lucide-react';
import type { ReactNode } from 'react';
import './vivarium-compare-intro.css';

/** Render a string with `backticks` becoming inline <code> spans.
 *  Markdown-lite — just enough for the card bodies. */
function renderInlineCode(text: string): ReactNode {
  return text.split('`').map((part, i) =>
    // Odd indices are inside backticks → wrap in <code>.
    i % 2 === 1 ? <code key={i}>{part}</code> : part,
  );
}

/* ============================================================================
 * Phase 7 V′ — orientation strip for /repro/compare.
 *
 * Sits between PageHero and <ReproCompareApp>. Surfaces the three input
 * modes that ReproCompare supports so a fresh visitor knows up-front
 * whether they have what they need (a verdict bundle) and which way
 * to bring it. Detailed how-to (the four-step bundle generation guide)
 * lives at the bottom of <ReproCompareApp> as before.
 * ========================================================================== */

type Lang = 'en' | 'ja';

const STRINGS = {
  en: {
    eyebrow: '// THREE WAYS TO LOAD A VERDICT',
    heading: 'Bring a verdict bundle, three ways.',
    sub: 'Every comparison starts with a Contract v1 verdict from your branch fix. Use whichever path fits how the bundle reached you.',
    cards: [
      {
        micro: 'DROP',
        title: 'Drop the bundle',
        body: 'Drag a `branch-fix-verdict.yml` artefact (zip) — or a bare `verdict.json` — onto the page. Original is auto-fetched from the deployed snapshot.',
      },
      {
        micro: 'PASTE',
        title: 'Paste verdict JSON',
        body: 'Paste the branch-fix and (optionally) original `verdict.json` payloads directly. Useful when CI logs are the only handle you have.',
      },
      {
        micro: 'SLUG + URL',
        title: 'Type the slug',
        body: 'Enter a recipe slug (e.g. `pandas/56679`) — the deployed snapshot loads automatically; supply your branch-fix verdict URL or drop file alongside.',
      },
    ],
  },
  ja: {
    eyebrow: '// VERDICT を読み込む 3 つの経路',
    heading: 'verdict バンドルを、3 つのうち 1 つで持参。',
    sub: '比較はすべて、自分のブランチ修正から得た Contract v1 verdict から始まる。手元にある形に合った経路を選ぶ。',
    cards: [
      {
        micro: 'DROP',
        title: 'バンドルをドロップ',
        body: '`branch-fix-verdict.yml` の artefact (zip) または bare の `verdict.json` をページに投下。オリジナルはデプロイ済みスナップショットから自動取得。',
      },
      {
        micro: 'PASTE',
        title: 'verdict JSON を貼り付け',
        body: 'branch-fix と（任意で）オリジナルの `verdict.json` を直接貼り付け。CI ログしか手がかりがない時に有用。',
      },
      {
        micro: 'SLUG + URL',
        title: 'slug を入力',
        body: 'レシピ slug（例: `pandas/56679`）を入れるとデプロイ済みスナップショットが自動ロード。branch-fix verdict の URL を入れるかファイルを併用。',
      },
    ],
  },
} as const;

const ICONS = [Upload, ClipboardPaste, Link2] as const;

export function VivariumCompareIntro({ lang = 'en' }: { lang?: Lang } = {}) {
  const s = STRINGS[lang];
  return (
    <section className="v-compare-intro" aria-labelledby="v-compare-intro-h">
      <div className="v-compare-intro__inner">
        <p className="v-compare-intro__eyebrow">{s.eyebrow}</p>
        <h2 id="v-compare-intro-h" className="v-compare-intro__heading">
          {s.heading}
        </h2>
        <p className="v-compare-intro__sub">{s.sub}</p>
        <div className="v-compare-intro__grid">
          {s.cards.map((card, i) => {
            const Icon = ICONS[i];
            return (
              <article key={i} className="v-compare-intro__card">
                <div className="v-compare-intro__card-head">
                  <Icon
                    className="v-compare-intro__icon"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span className="v-compare-intro__micro">{card.micro}</span>
                </div>
                <h3 className="v-compare-intro__card-title">{card.title}</h3>
                <p className="v-compare-intro__card-body">
                  {renderInlineCode(card.body)}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
