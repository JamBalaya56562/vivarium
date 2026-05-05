import { useMemo, useState } from 'react';
import './manifest-scaffolder.css';

/* ============================================================================
 * Phase 6 M.1 — interactive .vivarium/manifest.toml scaffolder.
 *
 * Hand-rolled form per ADR-0026 §1 (JSON Schema → labels/help only,
 * fields are hand-coded). Hand-rolled validation + TOML emission per
 * §2/§3. No backend; all state is in-memory.
 *
 * Output mirrors docs/public/spec/manifest.schema.json's example block.
 * ========================================================================== */

type Lang = 'en' | 'ja';
type LayerLiteral = 1 | 2 | 3;
type ExpectedVerdict = '' | 'reproduced' | 'unreproduced';

interface FormState {
  slug: string;
  layer: LayerLiteral | null;
  title: string;
  description: string;
  bug: {
    project: string;
    issue: string;
    upstream_url: string;
  };
  layer1: {
    page_url: string;
    expected_verdict: ExpectedVerdict;
  };
  layer2: {
    image: string;
    dockerfile: string;
    expected_verdict: ExpectedVerdict;
  };
  layer3: {
    image: string;
    dockerfile: string;
    expected_verdict: ExpectedVerdict;
  };
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const URL_RE = /^https?:\/\/.+/;

type FieldErrors = Partial<Record<string, string>>;

function validate(state: FormState): FieldErrors {
  const errors: FieldErrors = {};
  if (!state.slug) errors.slug = 'required';
  else if (!SLUG_RE.test(state.slug))
    errors.slug = "must match /^[a-z0-9]+(-[a-z0-9]+)*$/";
  if (state.layer == null) errors.layer = 'required';
  if (!state.bug.project) errors['bug.project'] = 'required';
  if (state.bug.issue !== '' && !/^\d+$/.test(state.bug.issue))
    errors['bug.issue'] = 'must be a non-negative integer';
  if (!state.bug.upstream_url) errors['bug.upstream_url'] = 'required';
  else if (!URL_RE.test(state.bug.upstream_url))
    errors['bug.upstream_url'] = 'must be http(s)://…';

  if (state.layer === 1) {
    if (!state.layer1.page_url) errors['layer1.page_url'] = 'required';
    else if (!URL_RE.test(state.layer1.page_url))
      errors['layer1.page_url'] = 'must be http(s)://…';
  } else if (state.layer === 2) {
    if (!state.layer2.image) errors['layer2.image'] = 'required';
  } else if (state.layer === 3) {
    if (!state.layer3.image) errors['layer3.image'] = 'required';
  }
  return errors;
}

/* ----------------------------- TOML emission ----------------------------- */

function escapeTomlBasic(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\t/g, '\\t');
}

function emitTomlString(value: string): string {
  if (value.includes('\n')) {
    // Multi-line basic string: backslash and triple-quote still need escaping.
    const escaped = value.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
    return `"""\n${escaped}\n"""`;
  }
  return `"${escapeTomlBasic(value)}"`;
}

function buildToml(state: FormState): string {
  const lines: string[] = [];
  lines.push(`manifest = "v1"`);
  lines.push(`slug = ${emitTomlString(state.slug)}`);
  if (state.layer != null) {
    lines.push(`layer = ${state.layer}`);
  }
  if (state.title) {
    lines.push(`title = ${emitTomlString(state.title)}`);
  }
  if (state.description) {
    lines.push(`description = ${emitTomlString(state.description)}`);
  }
  lines.push('');
  lines.push(`[bug]`);
  lines.push(`project = ${emitTomlString(state.bug.project)}`);
  const issue = state.bug.issue || '0';
  lines.push(`issue = ${issue}`);
  lines.push(`upstream_url = ${emitTomlString(state.bug.upstream_url)}`);

  if (state.layer === 1) {
    lines.push('');
    lines.push(`[layer1]`);
    lines.push(`page_url = ${emitTomlString(state.layer1.page_url)}`);
    if (state.layer1.expected_verdict) {
      lines.push(
        `expected_verdict = ${emitTomlString(state.layer1.expected_verdict)}`,
      );
    }
  } else if (state.layer === 2) {
    lines.push('');
    lines.push(`[layer2]`);
    lines.push(`image = ${emitTomlString(state.layer2.image)}`);
    if (state.layer2.dockerfile) {
      lines.push(`dockerfile = ${emitTomlString(state.layer2.dockerfile)}`);
    }
    if (state.layer2.expected_verdict) {
      lines.push(
        `expected_verdict = ${emitTomlString(state.layer2.expected_verdict)}`,
      );
    }
  } else if (state.layer === 3) {
    lines.push('');
    lines.push(`[layer3]`);
    lines.push(`image = ${emitTomlString(state.layer3.image)}`);
    if (state.layer3.dockerfile) {
      lines.push(`dockerfile = ${emitTomlString(state.layer3.dockerfile)}`);
    }
    if (state.layer3.expected_verdict) {
      lines.push(
        `expected_verdict = ${emitTomlString(state.layer3.expected_verdict)}`,
      );
    }
  }

  return lines.join('\n') + '\n';
}

/* --------------------------------- i18n ---------------------------------- */

interface Strings {
  formEyebrow: string;
  identityHeading: string;
  layerHeading: string;
  bugHeading: string;
  layerSpecificHeading: (layer: LayerLiteral | null) => string;
  outputEyebrow: string;
  slugLabel: string;
  slugHelp: string;
  titleLabel: string;
  titleHelp: string;
  descriptionLabel: string;
  descriptionHelp: string;
  layerLabel: string;
  layerHelp: string;
  layerOption: (n: LayerLiteral) => string;
  bugProjectLabel: string;
  bugIssueLabel: string;
  bugIssueHelp: string;
  bugUpstreamUrlLabel: string;
  pageUrlLabel: string;
  pageUrlHelp: string;
  imageLabel: string;
  dockerfileLabel: string;
  dockerfileHelp: string;
  expectedVerdictLabel: string;
  expectedVerdictHelp: string;
  expectedVerdictUnset: string;
  generate: string;
  copy: string;
  download: string;
  reset: string;
  noLayerYet: string;
  required: string;
  copied: string;
  emptyOutput: string;
  specLink: string;
}

const STRINGS: Record<Lang, Strings> = {
  en: {
    formEyebrow: '// 01 · MANIFEST FIELDS',
    identityHeading: 'Identity',
    layerHeading: 'Layer',
    bugHeading: 'Bug reference',
    layerSpecificHeading: (layer) =>
      layer == null
        ? 'Layer-specific'
        : layer === 1
          ? 'Layer 1 (WASM)'
          : layer === 2
            ? 'Layer 2 (Docker)'
            : 'Layer 3 (record-replay)',
    outputEyebrow: '// 02 · GENERATED TOML',
    slugLabel: 'slug',
    slugHelp:
      'Kebab-case identifier; lowercase ASCII, digits, hyphens. Must match `^[a-z0-9]+(-[a-z0-9]+)*$`.',
    titleLabel: 'title (optional)',
    titleHelp: 'Short human-readable title.',
    descriptionLabel: 'description (optional)',
    descriptionHelp:
      'Long-form description. Markdown allowed; consumers may render it or display verbatim.',
    layerLabel: 'layer',
    layerHelp:
      '1 = WASM in-browser, 2 = Docker, 3 = record-replay. Selecting a layer reveals that layer\'s required fields below.',
    layerOption: (n) =>
      n === 1 ? '1 · WASM' : n === 2 ? '2 · Docker' : '3 · record-replay',
    bugProjectLabel: 'bug.project',
    bugIssueLabel: 'bug.issue',
    bugIssueHelp:
      'Upstream issue number. 0 if no tracker entry exists. Defaults to 0 in the TOML output if left blank.',
    bugUpstreamUrlLabel: 'bug.upstream_url',
    pageUrlLabel: 'layer1.page_url',
    pageUrlHelp:
      'URL of the static reproduction page. Must conform to Vivarium Contract v1.',
    imageLabel: 'image',
    dockerfileLabel: 'dockerfile (optional)',
    dockerfileHelp:
      'Repo-relative path. Informational only — Vivarium does not build from this.',
    expectedVerdictLabel: 'expected_verdict (optional)',
    expectedVerdictHelp:
      "'reproduced' = bug reproduces; 'unreproduced' = bug does not reproduce (sentinel).",
    expectedVerdictUnset: '— (omit field)',
    generate: 'Generate TOML',
    copy: 'Copy',
    download: 'Download manifest.toml',
    reset: 'Reset',
    noLayerYet: 'Pick a layer to reveal its required fields.',
    required: 'required',
    copied: 'copied ✓',
    emptyOutput:
      'Fill in the form above and press "Generate TOML" to produce a `.vivarium/manifest.toml` you can copy or download.',
    specLink: 'Manifest v1 spec → /vivarium/spec/manifest-v1',
  },
  ja: {
    formEyebrow: '// 01 · マニフェストフィールド',
    identityHeading: 'アイデンティティ',
    layerHeading: 'レイヤー',
    bugHeading: 'バグ参照',
    layerSpecificHeading: (layer) =>
      layer == null
        ? 'レイヤー固有'
        : layer === 1
          ? 'レイヤー 1 (WASM)'
          : layer === 2
            ? 'レイヤー 2 (Docker)'
            : 'レイヤー 3 (記録再生)',
    outputEyebrow: '// 02 · 生成された TOML',
    slugLabel: 'slug',
    slugHelp:
      'kebab-case の識別子。小文字 ASCII / 数字 / ハイフンのみ。`^[a-z0-9]+(-[a-z0-9]+)*$` に一致する必要がある。',
    titleLabel: 'title (任意)',
    titleHelp: '短い人間向けのタイトル。',
    descriptionLabel: 'description (任意)',
    descriptionHelp:
      '長文の説明。Markdown 可。コンシューマー側がレンダリングするかそのまま表示するかを選ぶ。',
    layerLabel: 'layer',
    layerHelp:
      '1 = ブラウザ内 WASM、2 = Docker、3 = 記録再生。レイヤーを選ぶと、そのレイヤーに必要なフィールドが下に出る。',
    layerOption: (n) =>
      n === 1 ? '1 · WASM' : n === 2 ? '2 · Docker' : '3 · 記録再生',
    bugProjectLabel: 'bug.project',
    bugIssueLabel: 'bug.issue',
    bugIssueHelp:
      'アップストリームの issue 番号。トラッカーエントリがない場合は 0。空欄のときは TOML 出力で 0 が使われる。',
    bugUpstreamUrlLabel: 'bug.upstream_url',
    pageUrlLabel: 'layer1.page_url',
    pageUrlHelp:
      '静的再現ページの URL。Vivarium Contract v1 に準拠している必要がある。',
    imageLabel: 'image',
    dockerfileLabel: 'dockerfile (任意)',
    dockerfileHelp:
      'リポジトリ相対パス。情報目的のみ——Vivarium はここからビルドしない。',
    expectedVerdictLabel: 'expected_verdict (任意)',
    expectedVerdictHelp:
      '`reproduced` = バグが再現する。`unreproduced` = バグが再現しない (sentinel)。',
    expectedVerdictUnset: '— (フィールドを省略)',
    generate: 'TOML を生成',
    copy: 'コピー',
    download: 'manifest.toml をダウンロード',
    reset: 'リセット',
    noLayerYet: 'レイヤーを選ぶと、そのレイヤーに必要なフィールドが表示される。',
    required: '必須',
    copied: 'コピー済 ✓',
    emptyOutput:
      '上のフォームを埋めて「TOML を生成」を押すと、コピーまたはダウンロード可能な `.vivarium/manifest.toml` が出力される。',
    specLink: 'Manifest v1 仕様 → /vivarium/ja/spec/manifest-v1',
  },
};

/* ------------------------------ Components ------------------------------ */

const INITIAL_STATE: FormState = {
  slug: '',
  layer: null,
  title: '',
  description: '',
  bug: { project: '', issue: '', upstream_url: '' },
  layer1: { page_url: '', expected_verdict: '' },
  layer2: { image: '', dockerfile: '', expected_verdict: '' },
  layer3: { image: '', dockerfile: '', expected_verdict: '' },
};

function Field({
  label,
  help,
  error,
  children,
  required,
  requiredText,
}: {
  label: string;
  help?: string;
  error?: string;
  children: React.ReactNode;
  required?: boolean;
  requiredText: string;
}) {
  return (
    <label className={'v-mfs__field' + (error ? ' v-mfs__field--err' : '')}>
      <span className="v-mfs__label">
        <span className="v-mfs__label-name">{label}</span>
        {required ? (
          <span className="v-mfs__required">{requiredText}</span>
        ) : null}
      </span>
      {children}
      {error ? <span className="v-mfs__error">{error}</span> : null}
      {help ? <span className="v-mfs__help">{help}</span> : null}
    </label>
  );
}

export function ManifestScaffolder({ lang }: { lang: Lang }) {
  const s = STRINGS[lang];
  const [state, setState] = useState<FormState>(INITIAL_STATE);
  const [output, setOutput] = useState('');
  const [copied, setCopied] = useState(false);

  const errors = useMemo(() => validate(state), [state]);
  const hasErrors = Object.keys(errors).length > 0;

  const update = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setState((prev) => ({ ...prev, [field]: value }));
  };
  const updateBug = (k: keyof FormState['bug'], v: string) => {
    setState((prev) => ({ ...prev, bug: { ...prev.bug, [k]: v } }));
  };
  const updateLayer = <L extends 'layer1' | 'layer2' | 'layer3'>(
    layer: L,
    k: keyof FormState[L],
    v: string,
  ) => {
    setState((prev) => ({
      ...prev,
      [layer]: { ...prev[layer], [k]: v },
    }));
  };

  const generate = () => {
    if (hasErrors) return;
    setOutput(buildToml(state));
    setCopied(false);
  };

  const copy = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select-and-copy from the <pre>. */
    }
  };

  const download = () => {
    if (!output) return;
    const blob = new Blob([output], { type: 'application/toml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'manifest.toml';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setState(INITIAL_STATE);
    setOutput('');
    setCopied(false);
  };

  return (
    <div className="v-mfs">
      <p className="v-mfs__eyebrow">{s.formEyebrow}</p>

      {/* Identity group */}
      <fieldset className="v-mfs__group">
        <legend className="v-mfs__group-legend">{s.identityHeading}</legend>
        <Field
          label={s.slugLabel}
          help={s.slugHelp}
          error={errors.slug}
          required
          requiredText={s.required}
        >
          <input
            type="text"
            className="v-mfs__input"
            value={state.slug}
            onChange={(e) => update('slug', e.target.value)}
            placeholder="my-recipe-slug"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </Field>
        <Field
          label={s.titleLabel}
          help={s.titleHelp}
          requiredText={s.required}
        >
          <input
            type="text"
            className="v-mfs__input"
            value={state.title}
            onChange={(e) => update('title', e.target.value)}
            placeholder="bash: local shadows builtin's exit"
          />
        </Field>
        <Field
          label={s.descriptionLabel}
          help={s.descriptionHelp}
          requiredText={s.required}
        >
          <textarea
            className="v-mfs__input v-mfs__input--textarea"
            value={state.description}
            onChange={(e) => update('description', e.target.value)}
            rows={3}
            spellCheck={false}
          />
        </Field>
      </fieldset>

      {/* Layer group */}
      <fieldset className="v-mfs__group">
        <legend className="v-mfs__group-legend">{s.layerHeading}</legend>
        <Field
          label={s.layerLabel}
          help={s.layerHelp}
          error={errors.layer}
          required
          requiredText={s.required}
        >
          <div className="v-mfs__chips">
            {([1, 2, 3] as LayerLiteral[]).map((n) => (
              <button
                key={n}
                type="button"
                className={
                  'v-mfs__chip' +
                  (state.layer === n ? ' v-mfs__chip--on' : '')
                }
                onClick={() => update('layer', state.layer === n ? null : n)}
                aria-pressed={state.layer === n}
              >
                {s.layerOption(n)}
              </button>
            ))}
          </div>
        </Field>
      </fieldset>

      {/* Bug group */}
      <fieldset className="v-mfs__group">
        <legend className="v-mfs__group-legend">{s.bugHeading}</legend>
        <Field
          label={s.bugProjectLabel}
          error={errors['bug.project']}
          required
          requiredText={s.required}
        >
          <input
            type="text"
            className="v-mfs__input"
            value={state.bug.project}
            onChange={(e) => updateBug('project', e.target.value)}
            placeholder="bash"
          />
        </Field>
        <Field
          label={s.bugIssueLabel}
          help={s.bugIssueHelp}
          error={errors['bug.issue']}
          requiredText={s.required}
        >
          <input
            type="text"
            inputMode="numeric"
            className="v-mfs__input"
            value={state.bug.issue}
            onChange={(e) => updateBug('issue', e.target.value)}
            placeholder="0"
          />
        </Field>
        <Field
          label={s.bugUpstreamUrlLabel}
          error={errors['bug.upstream_url']}
          required
          requiredText={s.required}
        >
          <input
            type="url"
            className="v-mfs__input"
            value={state.bug.upstream_url}
            onChange={(e) => updateBug('upstream_url', e.target.value)}
            placeholder="https://lists.gnu.org/archive/html/bug-bash/"
          />
        </Field>
      </fieldset>

      {/* Layer-specific group */}
      <fieldset className="v-mfs__group">
        <legend className="v-mfs__group-legend">
          {s.layerSpecificHeading(state.layer)}
        </legend>
        {state.layer == null ? (
          <p className="v-mfs__placeholder">{s.noLayerYet}</p>
        ) : state.layer === 1 ? (
          <>
            <Field
              label={s.pageUrlLabel}
              help={s.pageUrlHelp}
              error={errors['layer1.page_url']}
              required
              requiredText={s.required}
            >
              <input
                type="url"
                className="v-mfs__input"
                value={state.layer1.page_url}
                onChange={(e) => updateLayer('layer1', 'page_url', e.target.value)}
                placeholder="https://example.org/repro/"
              />
            </Field>
            <Field
              label={s.expectedVerdictLabel}
              help={s.expectedVerdictHelp}
              requiredText={s.required}
            >
              <select
                className="v-mfs__input"
                value={state.layer1.expected_verdict}
                onChange={(e) =>
                  updateLayer('layer1', 'expected_verdict', e.target.value)
                }
              >
                <option value="">{s.expectedVerdictUnset}</option>
                <option value="reproduced">reproduced</option>
                <option value="unreproduced">unreproduced</option>
              </select>
            </Field>
          </>
        ) : state.layer === 2 ? (
          <>
            <Field
              label={s.imageLabel}
              error={errors['layer2.image']}
              required
              requiredText={s.required}
            >
              <input
                type="text"
                className="v-mfs__input"
                value={state.layer2.image}
                onChange={(e) => updateLayer('layer2', 'image', e.target.value)}
                placeholder="ghcr.io/example-org/example-recipe:latest"
              />
            </Field>
            <Field
              label={s.dockerfileLabel}
              help={s.dockerfileHelp}
              requiredText={s.required}
            >
              <input
                type="text"
                className="v-mfs__input"
                value={state.layer2.dockerfile}
                onChange={(e) => updateLayer('layer2', 'dockerfile', e.target.value)}
                placeholder="./Dockerfile"
              />
            </Field>
            <Field
              label={s.expectedVerdictLabel}
              help={s.expectedVerdictHelp}
              requiredText={s.required}
            >
              <select
                className="v-mfs__input"
                value={state.layer2.expected_verdict}
                onChange={(e) =>
                  updateLayer('layer2', 'expected_verdict', e.target.value)
                }
              >
                <option value="">{s.expectedVerdictUnset}</option>
                <option value="reproduced">reproduced</option>
                <option value="unreproduced">unreproduced</option>
              </select>
            </Field>
          </>
        ) : (
          <>
            <Field
              label={s.imageLabel}
              error={errors['layer3.image']}
              required
              requiredText={s.required}
            >
              <input
                type="text"
                className="v-mfs__input"
                value={state.layer3.image}
                onChange={(e) => updateLayer('layer3', 'image', e.target.value)}
                placeholder="ghcr.io/example-org/example-recipe-rr:latest"
              />
            </Field>
            <Field
              label={s.dockerfileLabel}
              help={s.dockerfileHelp}
              requiredText={s.required}
            >
              <input
                type="text"
                className="v-mfs__input"
                value={state.layer3.dockerfile}
                onChange={(e) => updateLayer('layer3', 'dockerfile', e.target.value)}
                placeholder="./Dockerfile"
              />
            </Field>
            <Field
              label={s.expectedVerdictLabel}
              help={s.expectedVerdictHelp}
              requiredText={s.required}
            >
              <select
                className="v-mfs__input"
                value={state.layer3.expected_verdict}
                onChange={(e) =>
                  updateLayer('layer3', 'expected_verdict', e.target.value)
                }
              >
                <option value="">{s.expectedVerdictUnset}</option>
                <option value="reproduced">reproduced</option>
                <option value="unreproduced">unreproduced</option>
              </select>
            </Field>
          </>
        )}
      </fieldset>

      {/* Action row */}
      <div className="v-mfs__actions">
        <button
          type="button"
          className="v-mfs__btn v-mfs__btn--primary"
          onClick={generate}
          disabled={hasErrors}
        >
          {s.generate}
        </button>
        <button
          type="button"
          className="v-mfs__btn v-mfs__btn--ghost"
          onClick={reset}
        >
          {s.reset}
        </button>
      </div>

      {/* Output */}
      <p className="v-mfs__eyebrow v-mfs__eyebrow--output">{s.outputEyebrow}</p>
      {output ? (
        <>
          <pre className="v-mfs__output">{output}</pre>
          <div className="v-mfs__actions">
            <button
              type="button"
              className="v-mfs__btn v-mfs__btn--primary"
              onClick={copy}
            >
              {copied ? s.copied : s.copy}
            </button>
            <button
              type="button"
              className="v-mfs__btn v-mfs__btn--ghost"
              onClick={download}
            >
              {s.download}
            </button>
          </div>
        </>
      ) : (
        <p className="v-mfs__empty">{s.emptyOutput}</p>
      )}
      <p className="v-mfs__spec-link">
        <a
          href={
            lang === 'ja'
              ? '/vivarium/ja/spec/manifest-v1'
              : '/vivarium/spec/manifest-v1'
          }
        >
          {s.specLink}
        </a>
      </p>
    </div>
  );
}

export default ManifestScaffolder;
