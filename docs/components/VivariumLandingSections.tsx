import {
  AppWindow,
  ArrowRight,
  Container,
  GitBranch,
  Pencil,
  RotateCcw,
  Sparkles,
  Timer,
} from 'lucide-react';
import './vivarium-landing.css';

/* ============================================================================
 * Phase 7 V′ — landing-page sections that sit BELOW the existing hero.
 *
 * Order on the page (informed by the V′ information-design audit + Stitch
 * wall-bouncing v1+v3 hybrid):
 *   1. <VivariumHero>        — existing
 *   2. <VivariumNumbers>     — proof up front (v3 evidence-first)
 *   3. <VivariumLayers>      — three-layer strip
 *   4. <VivariumPersonas>    — "where do you start?" 4-card grid
 *   5. <VivariumCtaBand>     — secondary CTA into gallery / spec
 *   6. <VivariumFooter>      — existing
 *
 * Each section is a standalone export so future pages can re-use individual
 * pieces (e.g. <VivariumLayers> may also appear on /architecture).
 * ========================================================================== */

type Lang = 'en' | 'ja';

/* --------------------------------- Icons --------------------------------- */

/* lucide-react icons accept a className prop; sizing and color come from
 * vivarium-landing.css so callers never have to pass pixel units.
 * lucide is tree-shaken — only the named imports above ship to the bundle. */

const LAYER_ICONS = [AppWindow, Container, RotateCcw] as const;
const PERSONA_ICONS = [Timer, GitBranch, Sparkles, Pencil] as const;

/* ------------------------------ i18n strings ----------------------------- */

const STRINGS = {
  en: {
    base: '/vivarium',
    numbers: {
      eyebrow: '// SHIPPED · 2026',
      items: [
        { value: '11', label: 'reproductions catalogued' },
        { value: '4', label: 'MCP tools' },
        { value: '6', label: 'phases closed' },
        { value: 'v1', label: 'public contract' },
      ],
    },
    layers: {
      eyebrow: '// THREE-LAYER ARCHITECTURE',
      heading: 'Pick the layer that fits your bug.',
      sub: 'You never choose by hand — each recipe declares its own layer. The layers exist because no single runtime fits every bug.',
      cards: [
        {
          pill: 'L1',
          accent: 'teal' as const,
          title: 'Browser-native, instant.',
          body: 'WebAssembly runtimes inside the visitor’s tab. Algorithms, parsers, in-memory database operations. Startup in milliseconds to seconds.',
          runtimes:
            'Pyodide · sqlite-wasm · wasm32-wasip1 · Ruby.wasm · PHP.wasm',
        },
        {
          pill: 'L2',
          accent: 'violet' as const,
          title: 'Container fidelity.',
          body: 'Real filesystem, real processes, real network. Catalogue model: pinned Dockerfile + GHCR image. The visitor reproduces locally with one `docker run`.',
          runtimes: 'Docker · Firecracker · gVisor',
        },
        {
          pill: 'L3',
          accent: 'coral' as const,
          title: 'Record-replay & deterministic.',
          body: 'Heisenbugs only. Vivarium pre-records the trace; the visitor replays. Burned-in GHCR images run on commodity Linux hosts — no PMU required.',
          runtimes: 'rr · Antithesis · CRIU · WASI Preview 3+',
        },
      ],
    },
    personas: {
      eyebrow: '// WHERE TO START',
      heading: 'Pick your starting point.',
      sub: 'Five minutes, five hours, or five months — the path is different.',
      cards: [
        {
          micro: 'TRY ONE',
          title: 'Open one reproduction in 5 minutes',
          body: 'No install, no account. Click a recipe, watch the verdict resolve from pending.',
          href: '/guide/getting-started',
        },
        {
          micro: 'INTEGRATE',
          title: 'Wire Vivarium into your repo',
          body: 'Drop a `.vivarium/manifest.toml` and the reusable workflow checks your verdicts on every push.',
          href: '/guide/integrate-with-your-repo',
        },
        {
          micro: 'AI AGENT',
          title: 'Drive Vivarium from Claude or Aider',
          body: 'The `@aletheia-works/vivarium-mcp` server exposes four tools. List recipes, fetch verdicts, match an error string.',
          href: '/guide/use-from-ai-agent',
        },
        {
          micro: 'CONTRIBUTE',
          title: 'Write your first reproduction',
          body: 'Scaffold a Layer 1 recipe directory and watch it appear in the gallery on the next deploy.',
          href: '/guide/write-your-first-reproduction',
        },
      ],
      arrow: 'Open',
    },
    cta: {
      eyebrow: '// SEE IT RUN',
      heading: 'Eleven real upstream bugs, running in a browser tab.',
      sub: 'pandas, numpy, CPython, Ruby, PHP, Rust regex on Layer 1. PostgreSQL, bash, flock, find/xargs on Layer 2. coreutils sort race on Layer 3.',
      primary: { label: 'Browse the gallery →', href: '/repro/' },
      ghost: { label: 'Read the spec', href: '/spec/' },
    },
  },
  ja: {
    base: '/vivarium/ja',
    numbers: {
      eyebrow: '// 出荷済み · 2026',
      items: [
        { value: '11', label: 'レシピ公開' },
        { value: '4', label: 'MCP ツール' },
        { value: '6', label: 'フェーズクローズ' },
        { value: 'v1', label: '公開コントラクト' },
      ],
    },
    layers: {
      eyebrow: '// 三層アーキテクチャ',
      heading: 'バグの種類に合うレイヤーを、レシピが選ぶ。',
      sub: 'ユーザーがレイヤーを選ぶ必要はない——レシピが自分に合った層を宣言する。三層あるのは、単一のランタイムですべてのバグに届かないから。',
      cards: [
        {
          pill: 'L1',
          accent: 'teal' as const,
          title: 'ブラウザネイティブ、瞬時起動。',
          body: '訪問者のタブの中で WebAssembly が直接実行される。アルゴリズム、パーサ、in-memory なデータベース操作。起動はミリ秒〜数秒。',
          runtimes:
            'Pyodide · sqlite-wasm · wasm32-wasip1 · Ruby.wasm · PHP.wasm',
        },
        {
          pill: 'L2',
          accent: 'violet' as const,
          title: 'コンテナで完全忠実度。',
          body: '本物のファイルシステム、本物のプロセス、本物のネットワーク。ピン留めした Dockerfile と GHCR イメージのカタログ。訪問者は 1 回の `docker run` でローカル再現。',
          runtimes: 'Docker · Firecracker · gVisor',
        },
        {
          pill: 'L3',
          accent: 'coral' as const,
          title: 'Record-replay と決定論的シミュレーション。',
          body: 'ハイゼンバグ専用。Vivarium が事前にトレースを録音し、訪問者は再生だけ。GHCR イメージに焼き込み、コモディティ Linux で動作——PMU 不要。',
          runtimes: 'rr · Antithesis · CRIU · WASI Preview 3+',
        },
      ],
    },
    personas: {
      eyebrow: '// はじめ方',
      heading: 'あなたの状況から入る。',
      sub: '5 分、5 時間、5 ヶ月——目的によって入り口は違う。',
      cards: [
        {
          micro: 'まず動かす',
          title: '5 分で 1 つのレシピを動かす',
          body: 'インストール・アカウント不要。レシピをクリックして verdict が pending から確定するのを見る。',
          href: '/guide/getting-started',
        },
        {
          micro: '統合する',
          title: 'Vivarium を自分のリポに繋ぐ',
          body: '`.vivarium/manifest.toml` を置いて、再利用可能ワークフローが push のたびに verdict を確認する。',
          href: '/guide/integrate-with-your-repo',
        },
        {
          micro: 'AI エージェント',
          title: 'Claude や Aider から Vivarium を呼ぶ',
          body: '`@aletheia-works/vivarium-mcp` が 4 つのツールを公開する。レシピ列挙、verdict 取得、エラー文字列マッチ。',
          href: '/guide/use-from-ai-agent',
        },
        {
          micro: '貢献する',
          title: 'はじめての再現を書く',
          body: 'Layer 1 のレシピディレクトリをスキャフォールドし、次のデプロイでギャラリーに現れるのを見る。',
          href: '/guide/write-your-first-reproduction',
        },
      ],
      arrow: '開く',
    },
    cta: {
      eyebrow: '// 実物を見る',
      heading:
        '11 個の本物のアップストリームバグが、ブラウザのタブ 1 枚で動く。',
      sub: 'Layer 1 の pandas、numpy、CPython、Ruby、PHP、Rust regex。Layer 2 の PostgreSQL、bash、flock、find/xargs。Layer 3 の coreutils sort race。',
      primary: { label: '再現一覧へ →', href: '/repro/' },
      ghost: { label: '仕様を読む', href: '/spec/' },
    },
  },
} as const;

/* -------------------------- VivariumNumbers ---------------------------- */

export function VivariumNumbers({ lang = 'en' }: { lang?: Lang } = {}) {
  const s = STRINGS[lang];
  return (
    <section className="v-land-numbers" aria-labelledby="v-numbers-eyebrow">
      <div className="v-land-numbers__inner">
        <p id="v-numbers-eyebrow" className="v-land__eyebrow">
          {s.numbers.eyebrow}
        </p>
        <div className="v-land-numbers__grid">
          {s.numbers.items.map((item, i) => (
            <div key={i} className="v-land-numbers__cell">
              <div className="v-land-numbers__value">{item.value}</div>
              <div className="v-land-numbers__label">{item.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------- VivariumLayers ----------------------------- */

export function VivariumLayers({ lang = 'en' }: { lang?: Lang } = {}) {
  const s = STRINGS[lang];
  return (
    <section className="v-land-layers" aria-labelledby="v-layers-heading">
      <div className="v-land-layers__inner">
        <p className="v-land__eyebrow">{s.layers.eyebrow}</p>
        <h2 id="v-layers-heading" className="v-land__heading">
          {s.layers.heading}
        </h2>
        <p className="v-land__sub">{s.layers.sub}</p>
        <div className="v-land-layers__grid">
          {s.layers.cards.map((card, i) => {
            const Icon = LAYER_ICONS[i];
            return (
              <article key={i} className="v-land-layer">
                <div className="v-land-layer__head">
                  <Icon
                    className={`v-land-layer__icon v-land-layer__icon--${card.accent}`}
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span
                    className={`v-land-layer__pill v-land-layer__pill--${card.accent}`}
                  >
                    {card.pill}
                  </span>
                </div>
                <h3 className="v-land-layer__title">{card.title}</h3>
                <p className="v-land-layer__body">{card.body}</p>
                <div className="v-land-layer__runtimes">{card.runtimes}</div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* -------------------------- VivariumPersonas --------------------------- */

export function VivariumPersonas({ lang = 'en' }: { lang?: Lang } = {}) {
  const s = STRINGS[lang];
  return (
    <section className="v-land-personas" aria-labelledby="v-personas-heading">
      <div className="v-land-personas__inner">
        <p className="v-land__eyebrow">{s.personas.eyebrow}</p>
        <h2 id="v-personas-heading" className="v-land__heading">
          {s.personas.heading}
        </h2>
        <p className="v-land__sub">{s.personas.sub}</p>
        <div className="v-land-personas__grid">
          {s.personas.cards.map((card, i) => {
            const Icon = PERSONA_ICONS[i];
            return (
              <a
                key={i}
                className="v-land-persona"
                href={`${s.base}${card.href}`}
              >
                <div className="v-land-persona__head">
                  <Icon
                    className="v-land-persona__icon"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span className="v-land-persona__micro">{card.micro}</span>
                </div>
                <h3 className="v-land-persona__title">{card.title}</h3>
                <p className="v-land-persona__body">{card.body}</p>
                <span className="v-land-persona__cta">
                  {s.personas.arrow}
                  <ArrowRight
                    className="v-land-persona__arrow"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </span>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* -------------------------- VivariumCtaBand ---------------------------- */

export function VivariumCtaBand({ lang = 'en' }: { lang?: Lang } = {}) {
  const s = STRINGS[lang];
  return (
    <section className="v-land-cta" aria-labelledby="v-cta-heading">
      <div className="v-land-cta__inner">
        <p className="v-land__eyebrow">{s.cta.eyebrow}</p>
        <h2 id="v-cta-heading" className="v-land-cta__heading">
          {s.cta.heading}
        </h2>
        <p className="v-land-cta__sub">{s.cta.sub}</p>
        <div className="v-land-cta__buttons">
          <a
            className="v-land-cta__btn v-land-cta__btn--primary"
            href={`${s.base}${s.cta.primary.href}`}
          >
            {s.cta.primary.label}
          </a>
          <a
            className="v-land-cta__btn v-land-cta__btn--ghost"
            href={`${s.base}${s.cta.ghost.href}`}
          >
            {s.cta.ghost.label}
          </a>
        </div>
      </div>
    </section>
  );
}
