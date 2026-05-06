import { useCallback, useEffect, useRef, useState } from 'react';
import './repro-compare.css';

/* ============================================================================
 * Phase 6 R.3 — branch-fix vs original verdict comparison surface.
 *
 * Consumes the artefact bundle locked by ADR-0020 (R.2 pipeline):
 *   - branch-fix-verdict.json   (always present)
 *   - original-verdict.json     (omitted when no deployed Pages snapshot)
 *
 * Both files conform to Vivarium Contract v1 (post-ADR-0018 evidence
 * extension). This module:
 *   1. Accepts file drop / file picker (zip artefact OR bare json).
 *   2. Accepts URL params (?slug=&branch_url=&original_url=).
 *   3. Falls back to JSON paste on CORS / parse failure.
 *   4. Validates each loaded verdict against Contract v1 v1 shape
 *      (hand-rolled — schema is static and tiny; ajv-standalone migration
 *      is deferred per ADR-0023 §1 Negative until the schema grows).
 *   5. Renders side-by-side comparison via the V.2 component family.
 *
 * The visitor's verdicts never leave the browser — all parsing,
 * validation, and rendering is client-side.
 * ========================================================================== */

/* ----------------------------- Types & schema ---------------------------- */

type VerdictLiteral = 'reproduced' | 'unreproduced';

export interface VerdictV1 {
  contract: 'v1';
  verdict: VerdictLiteral;
  exit_code: number;
  image_tag: string;
  image_digest: string;
  captured_at: string;
  stdout: string;
  stderr_tail: string;
}

interface ValidationError {
  path: string;
  message: string;
}

type ValidationResult =
  | { ok: true; data: VerdictV1 }
  | { ok: false; error: ValidationError };

const REQUIRED_FIELDS = [
  'contract',
  'verdict',
  'exit_code',
  'image_tag',
  'image_digest',
  'captured_at',
  'stdout',
  'stderr_tail',
] as const;

function validateVerdict(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      error: {
        path: '/',
        message: 'expected a JSON object at the top level',
      },
    };
  }
  const obj = raw as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    if (!(field in obj)) {
      return {
        ok: false,
        error: {
          path: `/${field}`,
          message: 'required field missing',
        },
      };
    }
  }

  if (obj.contract !== 'v1') {
    return {
      ok: false,
      error: {
        path: '/contract',
        message: `expected "v1", got ${JSON.stringify(obj.contract)}`,
      },
    };
  }
  if (obj.verdict !== 'reproduced' && obj.verdict !== 'unreproduced') {
    return {
      ok: false,
      error: {
        path: '/verdict',
        message: `expected "reproduced" or "unreproduced", got ${JSON.stringify(obj.verdict)}`,
      },
    };
  }
  if (typeof obj.exit_code !== 'number' || !Number.isInteger(obj.exit_code)) {
    return {
      ok: false,
      error: {
        path: '/exit_code',
        message: `expected integer, got ${typeof obj.exit_code}`,
      },
    };
  }
  if (typeof obj.image_tag !== 'string' || obj.image_tag.length === 0) {
    return {
      ok: false,
      error: {
        path: '/image_tag',
        message: 'expected non-empty string',
      },
    };
  }
  for (const field of [
    'image_digest',
    'captured_at',
    'stdout',
    'stderr_tail',
  ] as const) {
    if (typeof obj[field] !== 'string') {
      return {
        ok: false,
        error: {
          path: `/${field}`,
          message: `expected string, got ${typeof obj[field]}`,
        },
      };
    }
  }

  return {
    ok: true,
    data: {
      contract: 'v1',
      verdict: obj.verdict as VerdictLiteral,
      exit_code: obj.exit_code,
      image_tag: obj.image_tag as string,
      image_digest: obj.image_digest as string,
      captured_at: obj.captured_at as string,
      stdout: obj.stdout as string,
      stderr_tail: obj.stderr_tail as string,
    },
  };
}

/* --------------------------------- i18n ---------------------------------- */

type Lang = 'en' | 'ja';

interface Strings {
  pageEyebrow: string;
  pageTitle: string;
  pageSub: string;
  inputSection: string;
  dropPrompt: string;
  dropHint: string;
  orPickFile: string;
  acceptHint: string;
  pasteSection: string;
  pasteOriginal: string;
  pasteBranch: string;
  pasteApply: string;
  slugLabel: string;
  slugPlaceholder: string;
  slugHelp: string;
  expectedLabel: string;
  expectedFailDesc: string;
  expectedPassDesc: string;
  loading: string;
  fetchOriginal: string;
  refetchOriginal: string;
  clear: string;
  comparisonHeader: string;
  originalLabel: string;
  branchLabel: string;
  noOriginalDeployed: string;
  expectedMatchYes: string;
  expectedMatchNo: string;
  evidenceVerdict: string;
  evidenceExit: string;
  evidenceDuration: string;
  evidenceImageTag: string;
  evidenceImageDigest: string;
  evidenceCapturedAt: string;
  evidenceStdout: string;
  evidenceStderr: string;
  evidenceMissing: string;
  evidenceEmpty: string;
  errorTitle: string;
  errorAt: (path: string) => string;
  fetchFailed: (url: string) => string;
  parseFailed: string;
  zipMissingFiles: string;
  helpHeader: string;
  helpStep1: string;
  helpStep2: string;
  helpStep3: string;
  helpStep4: string;
  workflowDocs: string;
  semanticsHeader: string;
  semanticsBody: string;
  durationMsSuffix: string;
}

const STRINGS: Record<Lang, Strings> = {
  en: {
    pageEyebrow: '// REPRO COMPARE · v1',
    pageTitle: 'branch-fix vs original.',
    pageSub:
      'Drop a verdict bundle from `branch-fix-verdict.yml` and see your fix line up against the deployed snapshot. All parsing happens locally — your verdicts never leave this browser.',
    inputSection: '// 01 · LOAD VERDICTS',
    dropPrompt: 'Drop a verdict bundle here',
    dropHint:
      '`.zip` from a workflow run, or a single `branch-fix-verdict.json` / `original-verdict.json`.',
    orPickFile: 'or pick a file',
    acceptHint: 'Accepted: `.zip`, `.json`',
    pasteSection: '// 02 · PASTE FALLBACK',
    pasteOriginal: 'original-verdict.json',
    pasteBranch: 'branch-fix-verdict.json',
    pasteApply: 'Apply pasted JSON',
    slugLabel: 'Recipe slug',
    slugPlaceholder: 'e.g. bash-local-shadows-exit',
    slugHelp:
      'When set, the original side is fetched from the deployed gallery snapshot.',
    expectedLabel: 'Expected branch-fix verdict',
    expectedFailDesc:
      'unreproduced — bug does NOT reproduce on the fix (typical "fix works")',
    expectedPassDesc:
      'reproduced — bug still reproduces on the fix (regression check)',
    loading: 'Loading…',
    fetchOriginal: 'Fetch deployed original',
    refetchOriginal: 'Re-fetch deployed original',
    clear: 'Clear',
    comparisonHeader: '// 03 · COMPARISON',
    originalLabel: 'Original (deployed)',
    branchLabel: 'Branch-fix',
    noOriginalDeployed:
      'No deployed snapshot for this slug. The original side is empty; comparing against the branch-fix only.',
    expectedMatchYes: 'matches expected',
    expectedMatchNo: 'does NOT match expected',
    evidenceVerdict: 'verdict',
    evidenceExit: 'exit code',
    evidenceDuration: 'duration',
    evidenceImageTag: 'image tag',
    evidenceImageDigest: 'image digest',
    evidenceCapturedAt: 'captured at',
    evidenceStdout: 'stdout',
    evidenceStderr: 'stderr (tail)',
    evidenceMissing: 'no verdict loaded on this side',
    evidenceEmpty: '(empty)',
    errorTitle: 'Validation error',
    errorAt: (path) => `at ${path}`,
    fetchFailed: (url) => `Could not fetch ${url}. Falling back to paste.`,
    parseFailed: 'Could not parse JSON. Falling back to paste.',
    zipMissingFiles:
      'The dropped zip did not contain branch-fix-verdict.json or original-verdict.json.',
    helpHeader: '// HOW TO PRODUCE A BUNDLE',
    helpStep1:
      'Build and publish your branch-fix Docker image to a registry the GitHub Actions runner can pull from.',
    helpStep2:
      'Run `gh workflow run branch-fix-verdict.yml -f slug=<slug> -f branch_image=<ref>`. The workflow lives at `.github/workflows/branch-fix-verdict.yml`.',
    helpStep3:
      'Download the artefact named `branch-fix-verdict-<slug>-<run_id>` from the run page.',
    helpStep4:
      'Drop the zip onto this page. Original is fetched from the deployed snapshot automatically.',
    workflowDocs: 'Pipeline spec → /vivarium/spec/branch-fix-pipeline',
    semanticsHeader: '// VERDICT SEMANTICS',
    semanticsBody:
      '`reproduced` means the upstream bug was reproduced; `unreproduced` means it was not. A working branch-fix flips the verdict from `reproduced` to `unreproduced`.',
    durationMsSuffix: 'ms',
  },
  ja: {
    pageEyebrow: '// REPRO COMPARE · v1',
    pageTitle: 'ブランチ修正 と オリジナルの比較。',
    pageSub:
      '`branch-fix-verdict.yml` が出力した verdict バンドルをドロップして、自分の修正がデプロイ済みスナップショットに対してどう変化したかを確認できる。すべての解析はブラウザ内で完結する——verdict はこのブラウザの外に出ない。',
    inputSection: '// 01 · VERDICT を読み込む',
    dropPrompt: 'verdict バンドルをここにドロップ',
    dropHint:
      'ワークフロー実行から取得した `.zip`、または `branch-fix-verdict.json` / `original-verdict.json` 単体。',
    orPickFile: 'またはファイルを選択',
    acceptHint: '受け付ける形式: `.zip`、`.json`',
    pasteSection: '// 02 · ペースト経由',
    pasteOriginal: 'original-verdict.json',
    pasteBranch: 'branch-fix-verdict.json',
    pasteApply: 'ペーストした JSON を適用',
    slugLabel: 'レシピ slug',
    slugPlaceholder: '例: bash-local-shadows-exit',
    slugHelp:
      '指定するとオリジナル側はデプロイ済みギャラリースナップショットから取得される。',
    expectedLabel: '期待する branch-fix の verdict',
    expectedFailDesc:
      'unreproduced — 修正によりバグが再現しなくなる (典型的な「修正成立」)',
    expectedPassDesc:
      'reproduced — 修正後もバグが再現する (リグレッション確認)',
    loading: '読み込み中…',
    fetchOriginal: 'デプロイ済みオリジナルを取得',
    refetchOriginal: 'デプロイ済みオリジナルを再取得',
    clear: 'クリア',
    comparisonHeader: '// 03 · 比較',
    originalLabel: 'オリジナル (デプロイ済み)',
    branchLabel: 'Branch-fix',
    noOriginalDeployed:
      'この slug にはデプロイ済みスナップショットがない。オリジナル側は空のまま、branch-fix だけを表示している。',
    expectedMatchYes: '期待値と一致',
    expectedMatchNo: '期待値と不一致',
    evidenceVerdict: 'verdict',
    evidenceExit: 'exit コード',
    evidenceDuration: '所要時間',
    evidenceImageTag: 'image タグ',
    evidenceImageDigest: 'image ダイジェスト',
    evidenceCapturedAt: '取得日時',
    evidenceStdout: 'stdout',
    evidenceStderr: 'stderr (末尾)',
    evidenceMissing: 'この側にはまだ verdict が読み込まれていない',
    evidenceEmpty: '(空)',
    errorTitle: 'バリデーションエラー',
    errorAt: (path) => `${path} の位置で`,
    fetchFailed: (url) =>
      `${url} を取得できなかった。ペースト経由にフォールバック。`,
    parseFailed: 'JSON のパースに失敗した。ペースト経由にフォールバック。',
    zipMissingFiles:
      'ドロップされた zip に branch-fix-verdict.json も original-verdict.json も含まれていなかった。',
    helpHeader: '// バンドルを生成する手順',
    helpStep1:
      'GitHub Actions ランナーが認証なしで pull できるレジストリに、自分の branch-fix Docker イメージをビルドして publish する。',
    helpStep2:
      '`gh workflow run branch-fix-verdict.yml -f slug=<slug> -f branch_image=<ref>` を実行する。ワークフローは `.github/workflows/branch-fix-verdict.yml` にある。',
    helpStep3:
      '実行ページから `branch-fix-verdict-<slug>-<run_id>` という名前のアーティファクトをダウンロードする。',
    helpStep4:
      'その zip をこのページにドロップする。オリジナルはデプロイ済みスナップショットから自動取得される。',
    workflowDocs: 'パイプライン仕様 → /vivarium/ja/spec/branch-fix-pipeline',
    semanticsHeader: '// VERDICT のセマンティクス',
    semanticsBody:
      '`reproduced` は アップストリームのバグが再現したことを意味する。`unreproduced` は再現しなかったことを意味する。修正が機能している branch-fix は verdict を `reproduced` から `unreproduced` に反転させる。',
    durationMsSuffix: 'ms',
  },
};

/* ----------------------------- VerdictBadge ------------------------------ */

type BadgeVerdict = 'reproduced' | 'unreproduced' | 'pending' | 'unavailable';

export function VerdictBadge({
  verdict,
  size = 'md',
}: {
  verdict: BadgeVerdict;
  size?: 'sm' | 'md' | 'lg';
}) {
  const symbol =
    verdict === 'reproduced'
      ? '✓'
      : verdict === 'unreproduced'
        ? '✕'
        : verdict === 'pending'
          ? '◌'
          : '–';
  return (
    <span
      className={`v-vbadge v-vbadge--${verdict} v-vbadge--${size}`}
      data-verdict={verdict}
    >
      <span className="v-vbadge__symbol" aria-hidden="true">
        {symbol}
      </span>
      <span className="v-vbadge__label">{verdict}</span>
    </span>
  );
}

/* ---------------------------- EvidencePanel ------------------------------ */

interface EvidenceExtras {
  duration_ms?: number | null;
}

export function EvidencePanel({
  lang,
  label,
  verdict,
  extras,
  highlight = {},
}: {
  lang: Lang;
  label: string;
  verdict: VerdictV1 | null;
  extras?: EvidenceExtras;
  highlight?: { verdict?: boolean; exit_code?: boolean; duration_ms?: boolean };
}) {
  const s = STRINGS[lang];
  if (!verdict) {
    return (
      <article className="v-evidence v-evidence--empty">
        <header className="v-evidence__header">
          <span className="v-evidence__side-label">{label}</span>
        </header>
        <p className="v-evidence__missing">{s.evidenceMissing}</p>
      </article>
    );
  }
  return (
    <article className="v-evidence">
      <header className="v-evidence__header">
        <span className="v-evidence__side-label">{label}</span>
        <span
          className={
            'v-evidence__verdict' +
            (highlight.verdict ? ' v-evidence__verdict--diverges' : '')
          }
        >
          <VerdictBadge verdict={verdict.verdict} size="lg" />
        </span>
      </header>
      <dl className="v-evidence__facts">
        <div
          className={
            'v-evidence__row' +
            (highlight.exit_code ? ' v-evidence__row--diverges' : '')
          }
        >
          <dt>{s.evidenceExit}</dt>
          <dd>
            <code>{verdict.exit_code}</code>
          </dd>
        </div>
        {extras?.duration_ms != null ? (
          <div
            className={
              'v-evidence__row' +
              (highlight.duration_ms ? ' v-evidence__row--diverges' : '')
            }
          >
            <dt>{s.evidenceDuration}</dt>
            <dd>
              <code>
                {extras.duration_ms}
                {s.durationMsSuffix}
              </code>
            </dd>
          </div>
        ) : null}
        <div className="v-evidence__row">
          <dt>{s.evidenceImageTag}</dt>
          <dd>
            <code className="v-evidence__wrap">{verdict.image_tag}</code>
          </dd>
        </div>
        <div className="v-evidence__row">
          <dt>{s.evidenceImageDigest}</dt>
          <dd>
            <code className="v-evidence__wrap">
              {verdict.image_digest || '(empty)'}
            </code>
          </dd>
        </div>
        <div className="v-evidence__row">
          <dt>{s.evidenceCapturedAt}</dt>
          <dd>
            <code>{verdict.captured_at}</code>
          </dd>
        </div>
      </dl>
      <details className="v-evidence__stream" open>
        <summary>{s.evidenceStdout}</summary>
        <pre className="v-evidence__stream-body">
          {verdict.stdout || s.evidenceEmpty}
        </pre>
      </details>
      <details className="v-evidence__stream">
        <summary>{s.evidenceStderr}</summary>
        <pre className="v-evidence__stream-body">
          {verdict.stderr_tail || s.evidenceEmpty}
        </pre>
      </details>
    </article>
  );
}

/* -------------------------- VerdictCompareLayout ------------------------- */

export function VerdictCompareLayout({
  lang,
  slug,
  expected,
  original,
  branch,
}: {
  lang: Lang;
  slug: string;
  expected: VerdictLiteral;
  original: VerdictV1 | null;
  branch: VerdictV1 | null;
}) {
  const s = STRINGS[lang];
  const branchMatchesExpected = branch ? branch.verdict === expected : null;
  const verdictsDiverge =
    original != null && branch != null && original.verdict !== branch.verdict;
  const exitsDiverge =
    original != null &&
    branch != null &&
    original.exit_code !== branch.exit_code;

  const matchClassName =
    branchMatchesExpected == null
      ? ''
      : branchMatchesExpected
        ? ' v-compare-strip__match--ok'
        : ' v-compare-strip__match--bad';

  return (
    <div className="v-compare-strip">
      <header className="v-compare-strip__header">
        <div className="v-compare-strip__slug">
          {slug ? <code>{slug}</code> : null}
        </div>
        <div className={`v-compare-strip__match${matchClassName}`}>
          {branchMatchesExpected == null
            ? null
            : branchMatchesExpected
              ? `branch ${branch?.verdict} = expected ${expected} · ${s.expectedMatchYes}`
              : `branch ${branch?.verdict} ≠ expected ${expected} · ${s.expectedMatchNo}`}
        </div>
      </header>
      {original == null && branch != null ? (
        <p className="v-compare-strip__note">{s.noOriginalDeployed}</p>
      ) : null}
      <div className="v-compare-strip__cols">
        <EvidencePanel
          lang={lang}
          label={s.originalLabel}
          verdict={original}
          highlight={{}}
        />
        <EvidencePanel
          lang={lang}
          label={s.branchLabel}
          verdict={branch}
          highlight={{
            verdict: verdictsDiverge,
            exit_code: exitsDiverge,
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------ Drop / load ------------------------------ */

// Resolves the deployed Pages base for the *current* host (so fork
// deploys at <user>.github.io/<repo>/ work without rebuild). Looks up
// the URL path up to the `/repro` segment from window.location and
// reuses the same origin. Falls back to upstream during SSR / pre-hydrate.
function resolvePagesBase(): string {
  if (typeof window === 'undefined') {
    return 'https://aletheia-works.github.io/vivarium/repro';
  }
  const { origin, pathname } = window.location;
  const idx = pathname.indexOf('/repro');
  return idx >= 0
    ? `${origin}${pathname.slice(0, idx)}/repro`
    : `${origin}/repro`;
}

const PAGES_BASE = resolvePagesBase();

async function readZipEntries(file: File): Promise<{
  branch: VerdictV1 | null;
  original: VerdictV1 | null;
  rawErrors: ValidationError[];
}> {
  // Lazy-load JSZip — only paid for when the user actually drops a zip.
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(file);
  let branch: VerdictV1 | null = null;
  let original: VerdictV1 | null = null;
  const rawErrors: ValidationError[] = [];

  // Workflow artefacts can either contain the files at root or under
  // `verdict-bundle/`; accept both.
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    const base = name.split('/').pop() ?? name;
    if (base === 'branch-fix-verdict.json') {
      const text = await entry.async('text');
      const parsed = parseJsonSafe(text);
      if (parsed.ok) {
        const v = validateVerdict(parsed.data);
        if (v.ok) branch = v.data;
        else
          rawErrors.push({
            path: `branch:${v.error.path}`,
            message: v.error.message,
          });
      } else {
        rawErrors.push({ path: 'branch:/', message: parsed.error });
      }
    } else if (base === 'original-verdict.json') {
      const text = await entry.async('text');
      const parsed = parseJsonSafe(text);
      if (parsed.ok) {
        const v = validateVerdict(parsed.data);
        if (v.ok) original = v.data;
        else
          rawErrors.push({
            path: `original:${v.error.path}`,
            message: v.error.message,
          });
      } else {
        rawErrors.push({ path: 'original:/', message: parsed.error });
      }
    }
  }
  return { branch, original, rawErrors };
}

function parseJsonSafe(
  text: string,
): { ok: true; data: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchVerdictFromUrl(
  url: string,
): Promise<ValidationResult & { httpStatus?: number; networkError?: string }> {
  let res: Response;
  try {
    res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  } catch (err) {
    return {
      ok: false,
      error: { path: '/', message: 'network error' },
      networkError: err instanceof Error ? err.message : String(err),
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: { path: '/', message: `http ${res.status}` },
      httpStatus: res.status,
    };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return {
      ok: false,
      error: {
        path: '/',
        message: err instanceof Error ? err.message : 'json parse failed',
      },
    };
  }
  return validateVerdict(body);
}

/* ------------------------------ Main app ------------------------------- */

export interface ReproCompareProps {
  lang: Lang;
}

type Side = 'branch' | 'original';

interface SideError {
  side: Side;
  path: string;
  message: string;
}

export function ReproCompareApp({ lang }: ReproCompareProps) {
  const s = STRINGS[lang];
  const [slug, setSlug] = useState('');
  const [expected, setExpected] = useState<VerdictLiteral>('unreproduced');
  const [branch, setBranch] = useState<VerdictV1 | null>(null);
  const [original, setOriginal] = useState<VerdictV1 | null>(null);
  const [errors, setErrors] = useState<SideError[]>([]);
  const [busy, setBusy] = useState(false);
  const [pasteOriginal, setPasteOriginal] = useState('');
  const [pasteBranch, setPasteBranch] = useState('');

  const dropRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /* ----- URL params ingestion (run once on mount) ----- */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const urlSlug = params.get('slug');
    const urlBranch = params.get('branch_url');
    const urlOriginal = params.get('original_url');
    const urlExpected = params.get('expected');
    if (urlSlug) setSlug(urlSlug);
    if (urlExpected === 'reproduced' || urlExpected === 'unreproduced') {
      setExpected(urlExpected);
    }
    if (urlBranch) {
      setBusy(true);
      fetchVerdictFromUrl(urlBranch).then((r) => {
        if (r.ok) {
          setBranch(r.data);
        } else {
          setErrors((xs) => [
            ...xs,
            {
              side: 'branch',
              path: r.error.path,
              message: `${s.fetchFailed(urlBranch)} (${r.error.message})`,
            },
          ]);
        }
        setBusy(false);
      });
    }
    if (urlOriginal) {
      setBusy(true);
      fetchVerdictFromUrl(urlOriginal).then((r) => {
        if (r.ok) {
          setOriginal(r.data);
        } else {
          setErrors((xs) => [
            ...xs,
            {
              side: 'original',
              path: r.error.path,
              message: `${s.fetchFailed(urlOriginal)} (${r.error.message})`,
            },
          ]);
        }
        setBusy(false);
      });
    } else if (urlSlug) {
      // Auto-fetch deployed snapshot when slug is given without an explicit URL.
      const deployedUrl = `${PAGES_BASE}/${urlSlug}/verdict.json`;
      setBusy(true);
      fetchVerdictFromUrl(deployedUrl).then((r) => {
        if (r.ok) {
          setOriginal(r.data);
        }
        // 404 on deployed snapshot is silent — just leave original null.
        setBusy(false);
      });
    }
    // s only used for messages above; deps frozen at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.fetchFailed]);

  /* ----- File handling ----- */

  const ingestFile = useCallback(
    async (file: File) => {
      setBusy(true);
      const newErrors: SideError[] = [];
      try {
        if (file.name.toLowerCase().endsWith('.zip')) {
          const {
            branch: b,
            original: o,
            rawErrors,
          } = await readZipEntries(file);
          if (b) setBranch(b);
          if (o) setOriginal(o);
          if (b == null && o == null && rawErrors.length === 0) {
            newErrors.push({
              side: 'branch',
              path: '/',
              message: s.zipMissingFiles,
            });
          }
          for (const e of rawErrors) {
            const [sidePart, ...pathParts] = e.path.split(':');
            newErrors.push({
              side: sidePart === 'original' ? 'original' : 'branch',
              path: pathParts.join(':') || '/',
              message: e.message,
            });
          }
        } else {
          const text = await file.text();
          const parsed = parseJsonSafe(text);
          if (!parsed.ok) {
            newErrors.push({
              side: 'branch',
              path: '/',
              message: parsed.error,
            });
          } else {
            const v = validateVerdict(parsed.data);
            if (!v.ok) {
              newErrors.push({
                side: file.name.includes('original') ? 'original' : 'branch',
                path: v.error.path,
                message: v.error.message,
              });
            } else {
              if (file.name.includes('original')) setOriginal(v.data);
              else setBranch(v.data);
            }
          }
        }
      } catch (err) {
        newErrors.push({
          side: 'branch',
          path: '/',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      setErrors((xs) => [...xs, ...newErrors]);
      setBusy(false);
    },
    [s.zipMissingFiles],
  );

  const onDrop = useCallback(
    async (ev: React.DragEvent<HTMLDivElement>) => {
      ev.preventDefault();
      const files = Array.from(ev.dataTransfer.files);
      for (const file of files) {
        await ingestFile(file);
      }
    },
    [ingestFile],
  );

  const onDragOver = useCallback((ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
  }, []);

  const onPickFile = useCallback(
    async (ev: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(ev.target.files ?? []);
      for (const file of files) {
        await ingestFile(file);
      }
      ev.target.value = '';
    },
    [ingestFile],
  );

  /* ----- Paste apply ----- */

  const applyPasted = useCallback(() => {
    const newErrors: SideError[] = [];
    const apply = (side: Side, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const parsed = parseJsonSafe(trimmed);
      if (!parsed.ok) {
        newErrors.push({ side, path: '/', message: parsed.error });
        return;
      }
      const v = validateVerdict(parsed.data);
      if (!v.ok) {
        newErrors.push({ side, path: v.error.path, message: v.error.message });
        return;
      }
      if (side === 'branch') setBranch(v.data);
      else setOriginal(v.data);
    };
    apply('branch', pasteBranch);
    apply('original', pasteOriginal);
    setErrors((xs) => [...xs, ...newErrors]);
  }, [pasteBranch, pasteOriginal]);

  /* ----- Slug-driven original fetch ----- */

  const fetchOriginalFromSlug = useCallback(async () => {
    if (!slug) return;
    setBusy(true);
    const url = `${PAGES_BASE}/${slug}/verdict.json`;
    const r = await fetchVerdictFromUrl(url);
    if (r.ok) {
      setOriginal(r.data);
    } else {
      setErrors((xs) => [
        ...xs,
        {
          side: 'original',
          path: r.error.path,
          message: `${s.fetchFailed(url)} (${r.error.message})`,
        },
      ]);
    }
    setBusy(false);
  }, [slug, s]);

  const clear = useCallback(() => {
    setBranch(null);
    setOriginal(null);
    setErrors([]);
  }, []);

  const showComparison = branch != null || original != null;

  /* ------------------------------- Render ------------------------------- */

  return (
    <div className="v-rc">
      <section className="v-rc__section">
        <p className="v-rc__eyebrow">{s.inputSection}</p>
        <div className="v-rc__inputs">
          <label className="v-rc__field">
            <span className="v-rc__field-label">{s.slugLabel}</span>
            <input
              type="text"
              className="v-rc__field-input"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={s.slugPlaceholder}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <span className="v-rc__field-help">{s.slugHelp}</span>
          </label>
          <label className="v-rc__field">
            <span className="v-rc__field-label">{s.expectedLabel}</span>
            <select
              className="v-rc__field-input"
              value={expected}
              onChange={(e) =>
                setExpected(
                  e.target.value === 'reproduced'
                    ? 'reproduced'
                    : 'unreproduced',
                )
              }
            >
              <option value="unreproduced">{s.expectedFailDesc}</option>
              <option value="reproduced">{s.expectedPassDesc}</option>
            </select>
          </label>
        </div>

        {/* biome-ignore lint/a11y/useSemanticElements: drop targets need to
            be <div> to receive ondrop/ondragover; the role="button" + keyboard
            handler keeps the click-to-pick interaction accessible. */}
        <div
          ref={dropRef}
          className="v-rc__drop"
          onDrop={onDrop}
          onDragOver={onDragOver}
          role="button"
          tabIndex={0}
          aria-label={s.dropPrompt}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          <p className="v-rc__drop-prompt">{s.dropPrompt}</p>
          <p className="v-rc__drop-hint">{s.dropHint}</p>
          <p className="v-rc__drop-pick">
            <span className="v-rc__drop-pick-link">{s.orPickFile}</span>
            <span className="v-rc__drop-accept">{s.acceptHint}</span>
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.json,application/zip,application/json"
            multiple
            onChange={onPickFile}
            style={{ display: 'none' }}
          />
        </div>

        <div className="v-rc__actions">
          <button
            type="button"
            className="v-rc__btn v-rc__btn--primary"
            onClick={fetchOriginalFromSlug}
            disabled={!slug || busy}
          >
            {busy ? s.loading : original ? s.refetchOriginal : s.fetchOriginal}
          </button>
          <button
            type="button"
            className="v-rc__btn v-rc__btn--ghost"
            onClick={clear}
            disabled={!showComparison && errors.length === 0}
          >
            {s.clear}
          </button>
        </div>
      </section>

      {errors.length > 0 ? (
        <section className="v-rc__errors">
          <header className="v-rc__errors-header">{s.errorTitle}</header>
          <ul className="v-rc__errors-list">
            {errors.map((e, i) => (
              <li key={i} className={`v-rc__error v-rc__error--${e.side}`}>
                <span className="v-rc__error-side">[{e.side}]</span>{' '}
                <span className="v-rc__error-path">{s.errorAt(e.path)}</span>{' '}
                <span className="v-rc__error-msg">— {e.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <details className="v-rc__paste">
        <summary className="v-rc__eyebrow">{s.pasteSection}</summary>
        <div className="v-rc__paste-grid">
          <label>
            <span className="v-rc__field-label">{s.pasteOriginal}</span>
            <textarea
              className="v-rc__paste-area"
              rows={6}
              spellCheck={false}
              value={pasteOriginal}
              onChange={(e) => setPasteOriginal(e.target.value)}
              placeholder='{"contract":"v1","verdict":"reproduced",...}'
            />
          </label>
          <label>
            <span className="v-rc__field-label">{s.pasteBranch}</span>
            <textarea
              className="v-rc__paste-area"
              rows={6}
              spellCheck={false}
              value={pasteBranch}
              onChange={(e) => setPasteBranch(e.target.value)}
              placeholder='{"contract":"v1","verdict":"unreproduced",...}'
            />
          </label>
        </div>
        <button
          type="button"
          className="v-rc__btn v-rc__btn--ghost"
          onClick={applyPasted}
          disabled={!pasteBranch.trim() && !pasteOriginal.trim()}
        >
          {s.pasteApply}
        </button>
      </details>

      {showComparison ? (
        <section className="v-rc__section">
          <p className="v-rc__eyebrow">{s.comparisonHeader}</p>
          <VerdictCompareLayout
            lang={lang}
            slug={slug}
            expected={expected}
            original={original}
            branch={branch}
          />
        </section>
      ) : null}

      <section className="v-rc__section v-rc__help">
        <p className="v-rc__eyebrow">{s.helpHeader}</p>
        <ol className="v-rc__steps">
          <li>{s.helpStep1}</li>
          <li>{s.helpStep2}</li>
          <li>{s.helpStep3}</li>
          <li>{s.helpStep4}</li>
        </ol>
        <p className="v-rc__help-link">
          <a
            href={
              lang === 'ja'
                ? '/vivarium/ja/spec/branch-fix-pipeline'
                : '/vivarium/spec/branch-fix-pipeline'
            }
          >
            {s.workflowDocs}
          </a>
        </p>
      </section>

      <section className="v-rc__section v-rc__semantics">
        <p className="v-rc__eyebrow">{s.semanticsHeader}</p>
        <p>{s.semanticsBody}</p>
      </section>
    </div>
  );
}

export default ReproCompareApp;
