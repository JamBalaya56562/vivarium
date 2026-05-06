import { ArrowRight, Lock } from 'lucide-react';
import { useState } from 'react';
import './vivarium-hero.css';

/* ------------------------------ i18n strings ----------------------------- */

type Lang = 'en' | 'ja';

const STRINGS = {
  en: {
    kicker: '// CONTRACT v1 · OPEN SOURCE · APACHE-2.0',
    headline: ['Reproduce any bug.', 'Any language.', 'Any environment.'],
    lede: 'Vivarium is a three-layer reproduction substrate. WebAssembly for milliseconds, Docker for fidelity, and a third layer for everything else. Problem first, technology second.',
    ctaPrimary: 'Read the overview',
    ctaGhost: 'View on GitHub',
    visionHref: '/vivarium/overview',
    sectionAria: 'Vivarium hero',
    tabsAria: 'Reproduction examples',
    bringFrontAria: (label: string) =>
      `Bring ${label} reproduction to the front`,
    tabs: {
      cpython: { label: 'Python', sublabel: 'L1 · WASM' },
      postgres: { label: 'Postgres', sublabel: 'L2 · DOCKER' },
      ruby: { label: 'Ruby', sublabel: 'L1 · WASM' },
    },
    cpython: {
      eyebrow: 'VIVARIUM · LAYER 1 · PYODIDE · SQLITE3',
      title: 'Reproducing python/cpython#137205',
      lede: 'PRAGMA foreign_keys silently dropped under autocommit=False.',
      verdictText: 'fk_off ≠ fk_on',
      verdictPrefix: '✕ UNREPRODUCED',
      tabError: '1 error',
    },
    postgres: {
      eyebrow: 'VIVARIUM · LAYER 2 · DOCKER · POSTGRESQL',
      title: 'Reproducing PostgreSQL lost-update under READ COMMITTED',
      lede: 'Concurrent UPDATEs lose writes when a SELECT-then-UPDATE pattern omits row-level locks.',
      verdictText: 'RUNNING — tx-1 ⨯ tx-2',
      tabRunning: 'running',
      pulling: '[docker] Pulling postgres:15-alpine',
      ready: 'postgres ready in 74ms',
      waiting: 'waiting for both transactions to commit…',
    },
    ruby: {
      eyebrow: 'VIVARIUM · LAYER 1 · RUBY.WASM · UNICODE',
      title: 'Reproducing ruby/ruby#21709',
      lede: 'String#unicode_normalize edge case for combining diacritics in NFD form.',
      verdictText: '✓ REPRODUCED — bug reproduced',
      tabVerified: 'verified',
      okLine: 'round-trip lost (RuntimeError raised as expected)',
      verdictTrace:
        'verdict: REPRODUCED — issue#21709 reproducible in ruby.wasm',
    },
  },
  ja: {
    kicker: '// CONTRACT v1 · オープンソース · APACHE-2.0',
    headline: ['あらゆるバグを再現。', 'あらゆる言語で。', 'あらゆる環境で。'],
    lede: 'Vivarium は三層の再現基盤。ミリ秒単位の WebAssembly、忠実度の Docker、そしてそれ以外すべてのための第三のレイヤー。問題が先、技術は後。',
    ctaPrimary: '概要を読む',
    ctaGhost: 'GitHub で見る',
    visionHref: '/vivarium/ja/overview',
    sectionAria: 'Vivarium ヒーロー',
    tabsAria: '再現サンプル',
    bringFrontAria: (label: string) => `${label} 再現を前面に表示`,
    tabs: {
      cpython: { label: 'Python', sublabel: 'L1 · WASM' },
      postgres: { label: 'Postgres', sublabel: 'L2 · DOCKER' },
      ruby: { label: 'Ruby', sublabel: 'L1 · WASM' },
    },
    cpython: {
      eyebrow: 'VIVARIUM · LAYER 1 · PYODIDE · SQLITE3',
      title: 'python/cpython#137205 を再現',
      lede: 'PRAGMA foreign_keys が autocommit=False 下でサイレントに無視される。',
      verdictText: 'fk_off ≠ fk_on',
      verdictPrefix: '✕ UNREPRODUCED',
      tabError: 'エラー 1 件',
    },
    postgres: {
      eyebrow: 'VIVARIUM · LAYER 2 · DOCKER · POSTGRESQL',
      title: 'READ COMMITTED 下での PostgreSQL lost-update を再現',
      lede: '並行 UPDATE が、SELECT 後に UPDATE するパターンで行ロックを省略すると書き込みを失う。',
      verdictText: '実行中 — tx-1 ⨯ tx-2',
      tabRunning: '実行中',
      pulling: '[docker] postgres:15-alpine をプル中',
      ready: 'postgres 準備完了 (74ms)',
      waiting: '両トランザクションのコミットを待機中…',
    },
    ruby: {
      eyebrow: 'VIVARIUM · LAYER 1 · RUBY.WASM · UNICODE',
      title: 'ruby/ruby#21709 を再現',
      lede: 'NFD 形式の結合ダイアクリティカル記号における String#unicode_normalize のエッジケース。',
      verdictText: '✓ REPRODUCED — バグ再現',
      tabVerified: '検証済み',
      okLine: 'round-trip lost (RuntimeError を期待通り raise)',
      verdictTrace: 'verdict: REPRODUCED — issue#21709 が ruby.wasm で再現可能',
    },
  },
} as const;

/* ------------------------------- Icons ------------------------------- */

/* WasmGlyph + DockerGlyph stay inline because they are brand-evoking
 * marks tied to specific runtimes, not generic UI icons. The two
 * generic icons (cta arrow + URL-bar lock) come from lucide-react. */

const WasmGlyph = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M3 6h3l1.5 7L9 6h2l1.5 7L14 6h3l-2.5 12h-2L11 11l-1.5 7h-2L5 6Z" />
  </svg>
);

const DockerGlyph = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M5 11h2v2H5zM8 11h2v2H8zM11 11h2v2h-2zM8 8h2v2H8zM11 8h2v2h-2zM11 5h2v2h-2zM14 11h2v2h-2zM21 11h-2.4c-.3-1-1.4-1.7-2.6-1.7-.5 0-.9.1-1.3.3 1.3.4 2.3 1.4 2.3 2.7 0 .8-.4 1.5-1 2H21v-3.3z" />
  </svg>
);

/* ----------------------------- Window shell ----------------------------- */

type BadgeKind = 'wasm' | 'docker';

const ChromeBadge = ({ kind }: { kind: BadgeKind }) => {
  if (kind === 'wasm') {
    return (
      <span className="v-window__chrome-badge v-window__chrome-badge--wasm">
        <WasmGlyph />
        WASM
      </span>
    );
  }
  return (
    <span className="v-window__chrome-badge v-window__chrome-badge--docker">
      <DockerGlyph />
      DOCKER
    </span>
  );
};

const Chrome = ({ url, badge }: { url: string; badge: BadgeKind }) => (
  <div className="v-window__chrome">
    <div className="v-window__dots">
      <span className="v-window__dot v-window__dot--red" />
      <span className="v-window__dot v-window__dot--yellow" />
      <span className="v-window__dot v-window__dot--green" />
    </div>
    <div className="v-window__url v-window__url--pill">
      <Lock className="v-window__lock" strokeWidth={2.5} aria-hidden="true" />
      {url}
    </div>
    <ChromeBadge kind={badge} />
  </div>
);

/* ------------ Per-reproduction inner content (no outer wrapper) ------------ */

const CpythonInner = ({ s }: { s: typeof STRINGS.en }) => (
  <>
    <Chrome url="vivarium.dev/layer1-wasm/cpython-137205" badge="wasm" />
    <div className="v-window__body">
      <span className="v-window__eyebrow">{s.cpython.eyebrow}</span>
      <h2 className="v-window__title">{s.cpython.title}</h2>
      <p className="v-window__lede">{s.cpython.lede}</p>
      <span className="v-verdict v-verdict--unreproduced">
        {s.cpython.verdictPrefix}
        <span className="v-verdict--unreproduced__sep">|</span>
        {s.cpython.verdictText}
      </span>

      <div className="v-code">
        <span className="v-code__comment"># repro.py</span>
        <span className="v-code__line">
          <span className="v-code__kw">import</span> sqlite3
        </span>
        <span className="v-code__line">
          <span className="v-code__kw">def</span>{' '}
          <span className="v-code__fn">test_fk</span>():
        </span>
        <span className="v-code__line v-code__indent">
          conn = sqlite3.connect(
          <span className="v-code__str">':memory:'</span>)
        </span>
        <span className="v-code__line v-code__indent">
          fk_on = conn.execute(
          <span className="v-code__str">'PRAGMA foreign_keys'</span>
          ).fetchone()[<span className="v-code__num">0</span>]
        </span>
        <span className="v-code__line v-code__indent">
          <span className="v-code__kw">assert</span> fk_on =={' '}
          <span className="v-code__num">1</span>
        </span>
      </div>

      <div className="v-console">
        <div className="v-console__tabs">
          <span className="v-console__tab">Elements</span>
          <span className="v-console__tab v-console__tab--active">Console</span>
          <span className="v-console__tab">Network</span>
          <span className="v-console__tab">Sources</span>
          <span className="v-console__tab v-console__tab--filter">
            {s.cpython.tabError}
          </span>
        </div>
        <div className="v-console__body">
          <div className="v-console__line v-console__line--input">
            <span className="v-console__chev">›</span>
            <span>await pyodide.runPythonAsync(repro)</span>
          </div>
          <div className="v-console__line v-console__line--error">
            <span className="v-console__icon">✕</span>
            <span>AssertionError: 0 != 1</span>
          </div>
          <div className="v-console__line v-console__line--trace">
            <span>at test_fk (repro.py:5)</span>
          </div>
        </div>
      </div>
    </div>
  </>
);

const PostgresInner = ({ s }: { s: typeof STRINGS.en }) => (
  <>
    <Chrome
      url="vivarium.dev/layer2-docker/postgres-lost-update"
      badge="docker"
    />
    <div className="v-window__body">
      <span className="v-window__eyebrow v-window__eyebrow--violet">
        {s.postgres.eyebrow}
      </span>
      <h2 className="v-window__title">{s.postgres.title}</h2>
      <p className="v-window__lede">{s.postgres.lede}</p>
      <span className="v-verdict v-verdict--pending">
        {s.postgres.verdictText}
      </span>

      <div className="v-code">
        <span className="v-code__comment"># compose-up.sh</span>
        <span className="v-code__line">
          <span className="v-code__kw">docker</span> compose up -d
        </span>
        <span className="v-code__line">
          <span className="v-code__kw">psql</span> -c{' '}
          <span className="v-code__str">
            "SET TRANSACTION ISOLATION LEVEL READ COMMITTED"
          </span>
        </span>
        <span className="v-code__line">
          <span className="v-code__kw">parallel</span> ./tx.sh ::={' '}
          <span className="v-code__num">1</span>{' '}
          <span className="v-code__num">2</span>
        </span>
      </div>

      <div className="v-console">
        <div className="v-console__tabs">
          <span className="v-console__tab v-console__tab--active">
            container.log
          </span>
          <span className="v-console__tab">tx-1.log</span>
          <span className="v-console__tab">tx-2.log</span>
          <span className="v-console__tab v-console__tab--running">
            {s.postgres.tabRunning}
          </span>
        </div>
        <div className="v-console__body">
          <div className="v-console__line">
            <span className="v-console__chev">›</span>
            <span>{s.postgres.pulling}</span>
          </div>
          <div className="v-console__line">
            <span className="v-console__chev v-console__chev--ok">✓</span>
            <span>{s.postgres.ready}</span>
          </div>
          <div className="v-console__line v-console__line--input">
            <span className="v-console__chev">›</span>
            <span>tx-1: UPDATE accounts SET balance = balance + 100</span>
          </div>
          <div className="v-console__line v-console__line--input">
            <span className="v-console__chev">›</span>
            <span>tx-2: UPDATE accounts SET balance = balance - 50</span>
          </div>
          <div className="v-console__line v-console__line--trace">
            <span>{s.postgres.waiting}</span>
          </div>
        </div>
      </div>
    </div>
  </>
);

const RubyInner = ({ s }: { s: typeof STRINGS.en }) => (
  <>
    <Chrome url="vivarium.dev/layer1-wasm/ruby-21709" badge="wasm" />
    <div className="v-window__body">
      <span className="v-window__eyebrow">{s.ruby.eyebrow}</span>
      <h2 className="v-window__title">{s.ruby.title}</h2>
      <p className="v-window__lede">{s.ruby.lede}</p>
      <span className="v-verdict v-verdict--reproduced">
        {s.ruby.verdictText}
      </span>

      <div className="v-code">
        <span className="v-code__comment"># repro.rb</span>
        <span className="v-code__line">
          s = <span className="v-code__str">"café"</span>
        </span>
        <span className="v-code__line">
          nfd = s.unicode_normalize(
          <span className="v-code__str">:nfd</span>)
        </span>
        <span className="v-code__line">
          back = nfd.unicode_normalize(
          <span className="v-code__str">:nfc</span>)
        </span>
        <span className="v-code__line">
          <span className="v-code__kw">raise</span>{' '}
          <span className="v-code__str">"round-trip lost"</span>{' '}
          <span className="v-code__kw">unless</span> s == back
        </span>
      </div>

      <div className="v-console">
        <div className="v-console__tabs">
          <span className="v-console__tab">Elements</span>
          <span className="v-console__tab v-console__tab--active">Console</span>
          <span className="v-console__tab">Network</span>
          <span className="v-console__tab">Sources</span>
          <span className="v-console__tab v-console__tab--ok">
            {s.ruby.tabVerified}
          </span>
        </div>
        <div className="v-console__body">
          <div className="v-console__line v-console__line--input">
            <span className="v-console__chev">›</span>
            <span>await rubyVm.evalAsync(repro)</span>
          </div>
          <div className="v-console__line">
            <span className="v-console__chev v-console__chev--ok">✓</span>
            <span>{s.ruby.okLine}</span>
          </div>
          <div className="v-console__line v-console__line--trace">
            <span>{s.ruby.verdictTrace}</span>
          </div>
        </div>
      </div>
    </div>
  </>
);

/* ------------------------------- Tab data ------------------------------- */

type TabId = 'cpython' | 'postgres' | 'ruby';
type SlotName = 'front' | 'mid' | 'low';

const TAB_ORDER: TabId[] = ['cpython', 'postgres', 'ruby'];

const TAB_STATUS: Record<TabId, 'unreproduced' | 'pending' | 'reproduced'> = {
  cpython: 'unreproduced',
  postgres: 'pending',
  ruby: 'reproduced',
};

const INITIAL_SLOTS: Record<TabId, SlotName> = {
  cpython: 'front',
  postgres: 'mid',
  ruby: 'low',
};

/* ---------------------------- Hero component ---------------------------- */

export function VivariumHero({ lang = 'en' }: { lang?: Lang } = {}) {
  const [slots, setSlots] = useState<Record<TabId, SlotName>>(INITIAL_SLOTS);
  const s = STRINGS[lang];

  /**
   * Click a non-front window → swap it with whichever window currently sits
   * in the front slot. The clicked window's old slot is taken by the previous
   * front window. The third window stays in place. CSS transitions on the
   * slot-position styles do the animation.
   */
  const swapToFront = (clickedId: TabId) => {
    if (slots[clickedId] === 'front') return;
    const oldFrontId = TAB_ORDER.find((id) => slots[id] === 'front')!;
    const oldSlotOfClicked = slots[clickedId];
    setSlots({
      ...slots,
      [clickedId]: 'front',
      [oldFrontId]: oldSlotOfClicked,
    });
  };

  const renderInner = (id: TabId) => {
    if (id === 'cpython') return <CpythonInner s={s} />;
    if (id === 'postgres') return <PostgresInner s={s} />;
    return <RubyInner s={s} />;
  };

  return (
    <section className="v-hero" aria-label={s.sectionAria}>
      {/* Left column — copy + CTAs */}
      <div className="v-hero__left">
        <div className="v-hero__inner">
          <span className="v-hero__kicker">{s.kicker}</span>

          <h1 className="v-hero__headline">
            {s.headline[0]}
            <br />
            {s.headline[1]}
            <br />
            <span className="v-hero__headline-gradient">{s.headline[2]}</span>
          </h1>

          <p className="v-hero__lede">{s.lede}</p>

          <div className="v-hero__ctas">
            <a className="v-hero__cta v-hero__cta--primary" href={s.visionHref}>
              {s.ctaPrimary}
              <ArrowRight
                className="v-hero__cta-arrow"
                strokeWidth={2}
                aria-hidden="true"
              />
            </a>
            <a
              className="v-hero__cta v-hero__cta--ghost"
              href="https://github.com/aletheia-works/vivarium"
              target="_blank"
              rel="noreferrer"
            >
              {s.ctaGhost}
            </a>
          </div>
        </div>
      </div>

      {/* Right column — bento with click-to-swap (desktop) /
                        tab strip (mobile, controlled by same state) */}
      <div className="v-hero__right">
        <div className="v-hero__glow v-hero__glow--teal" aria-hidden="true" />
        <div className="v-hero__glow v-hero__glow--violet" aria-hidden="true" />

        <div className="v-hero__particles" aria-hidden="true">
          <span>{'{'}</span>
          <span>{'}'}</span>
          <span>;</span>
          <span>→</span>
          <span>0</span>
          <span>1</span>
          <span>{'{'}</span>
          <span>{'}'}</span>
        </div>

        <div className="v-hero__stage">
          {/* Tab strip — visible only on mobile via CSS */}
          <div className="v-tabs" role="tablist" aria-label={s.tabsAria}>
            {TAB_ORDER.map((id) => {
              const isActive = slots[id] === 'front';
              const tab = s.tabs[id];
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`v-tab${isActive ? ' v-tab--active' : ''}`}
                  onClick={() => swapToFront(id)}
                >
                  <span
                    className={`v-tab__dot v-tab__dot--${TAB_STATUS[id]}`}
                    aria-hidden="true"
                  />
                  <span className="v-tab__label">{tab.label}</span>
                  <span className="v-tab__sublabel">{tab.sublabel}</span>
                </button>
              );
            })}
          </div>

          {/* Bento — three windows slot-positioned. Clicking a non-front
              window swaps it with whichever is currently front. */}
          <div className="v-bento">
            {TAB_ORDER.map((id) => {
              const slot = slots[id];
              const isFront = slot === 'front';
              const tab = s.tabs[id];
              const className = `v-window v-window--slot-${slot}`;
              if (isFront) {
                return (
                  <div key={id} className={className}>
                    {renderInner(id)}
                  </div>
                );
              }
              return (
                // biome-ignore lint/a11y/useSemanticElements: <button> can't legally contain the window's nested interactive content (chrome / code / console); div + role="button" + keyboard handler keeps the swap interaction accessible
                <div
                  key={id}
                  className={className}
                  onClick={() => swapToFront(id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      swapToFront(id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={s.bringFrontAria(tab.label)}
                >
                  {renderInner(id)}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export default VivariumHero;
