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
import siteStats from '../_generated/site-stats.json';
import './vivarium-landing.css';

type Lang = 'en' | 'ja';

const LAYER_ICONS = [AppWindow, Container, RotateCcw] as const;
const PERSONA_ICONS = [Timer, GitBranch, Sparkles, Pencil] as const;

const STRINGS = {
  en: {
    base: '/vivarium',
    numbers: {
      eyebrow: '// SHIPPED · 2026',
      items: [
        { value: String(siteStats.recipes), label: 'reproductions catalogued' },
        { value: String(siteStats.mcpTools), label: 'MCP tools' },
        { value: '8', label: 'phases closed' },
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
          body: `The \`@aletheia-works/vivarium-mcp\` server exposes ${siteStats.mcpTools} tools for catalogue reads, verdict lookup, matching, and scaffolding.`,
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
      heading: `${siteStats.recipes} real upstream bugs, routed through the right layer.`,
      sub: 'Layer 1 covers browser-native WASM recipes; Layer 2 ships Docker reproductions; Layer 3 carries record-replay snapshots.',
      primary: { label: 'Browse the gallery →', href: '/repro/' },
      ghost: { label: 'Read the spec', href: '/spec/' },
    },
  },
  ja: {
    base: '/vivarium/ja',
    numbers: {
      eyebrow: '// 出荷済み · 2026',
      items: [
        { value: String(siteStats.recipes), label: 'レシピ公開' },
        { value: String(siteStats.mcpTools), label: 'MCP ツール' },
        { value: '8', label: 'フェーズクローズ' },
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
          body: `\`@aletheia-works/vivarium-mcp\` が ${siteStats.mcpTools} つのツールを公開する。カタログ参照、verdict 取得、エラー文字列マッチ、scaffolding まで扱える。`,
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
      heading: `${siteStats.recipes} 個の本物のアップストリームバグを、適したレイヤーで再現する。`,
      sub: 'Layer 1 はブラウザ内 WASM、Layer 2 は Docker 再現、Layer 3 は record-replay スナップショットを扱う。',
      primary: { label: '再現一覧へ →', href: '/repro/' },
      ghost: { label: '仕様を読む', href: '/spec/' },
    },
  },
} as const;

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
