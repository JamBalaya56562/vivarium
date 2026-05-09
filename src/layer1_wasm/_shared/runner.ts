// Phase 8 V″ — editable reproduction script + Run / Reset buttons.
//
// Recipes mount this helper after the baseline run finishes by calling
// `enableRunner({...})`. It:
//   1. Wraps the existing `<pre><code id="repro-code">` block (which
//      `highlight-repros.ts` pre-renders with Shiki spans) inside a
//      viewport that also contains a hidden `<textarea>`. The Shiki
//      `<pre>` is the default surface — colourful, read-only.
//   2. Inserts a `<div class="vh-runner__head">` flex row that hosts
//      the script column's `<h2>` heading next to an Edit / Run /
//      Reset action group. Putting the actions inline with the
//      heading saves the column-height that an action bar below the
//      editor would otherwise consume.
//   3. On Edit, swaps the `<pre>` for the `<textarea>` (drops Shiki
//      highlighting during edit — see ADR-0035 §"Negative"). Edits
//      stay in the textarea until Reset.
//   4. On Run, calls the recipe's `runFix(source)` callback with the
//      currently-active source (textarea content if editing, the
//      baseline source otherwise) and updates `#output` + the verdict
//      pill in place.
//   5. On Reset, restores the baseline source, switches back to view
//      mode, and re-runs.
//
// Reuses the `PathACapturedRun` shape from `_shared/path_a.ts` so each
// recipe needs only one `captureRun(source)` adapter to participate in
// both the runner here and the existing Path A panel.
//
// Design decisions in ADR-0035.

import type { PathACapturedRun } from './path_a.js';
import { setVerdict } from './verdict.js';

export interface RunnerOptions {
  /** Recipe slug — informational, included in the runner mount-point id. */
  slug: string;
  /** The recipe's canonical reproduction source (plaintext). Used as the
   *  initial textarea value and the Reset target. */
  baselineSource: string;
  /** Run the (possibly edited) source through the same already-loaded
   *  WASM interpreter. Owns the actual re-run; the runner only
   *  marshals the source string and surfaces the captured result. */
  runFix: (source: string) => Promise<PathACapturedRun>;
  /** DOM id of the existing `<pre><code>` block holding the
   *  Shiki-highlighted baseline source. Defaults to `repro-code`. */
  codeBlockId?: string;
  /** DOM id of the `<pre>` block that holds the run output (the
   *  same element existing chrome.js wires the progress overlay over).
   *  Defaults to `output`. */
  outputId?: string;
}

const SVG_PLAY =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
const SVG_PENCIL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
const SVG_EYE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const SVG_RESET =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | undefined> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function enableRunner(opts: RunnerOptions): void {
  const codeBlockId = opts.codeBlockId ?? 'repro-code';
  const outputId = opts.outputId ?? 'output';

  const codeEl = document.getElementById(codeBlockId);
  if (!codeEl) {
    console.warn(
      `[vivarium runner] #${codeBlockId} not found — runner disabled.`,
    );
    return;
  }

  // The Shiki-rendered code lives inside `<pre><code id="repro-code">`.
  // We wrap the `<pre>` in a viewport that also contains a hidden
  // `<textarea>` for edit mode.
  const preEl = codeEl.closest('pre');
  if (!preEl) {
    console.warn(
      `[vivarium runner] #${codeBlockId} is not inside a <pre> — runner disabled.`,
    );
    return;
  }

  const preParent = preEl.parentElement;
  if (!preParent) {
    console.warn('[vivarium runner] <pre> has no parent — runner disabled.');
    return;
  }

  // Capture the script column + its <h2> BEFORE moving <pre> into the
  // viewport — once <pre> is detached and re-parented under viewport,
  // `closest('.vh-main__col')` would return null because viewport has
  // no parent yet.
  const colEl = preEl.closest<HTMLElement>('.vh-main__col');
  const h2El = colEl?.querySelector('h2') ?? null;

  const outputEl = document.getElementById(outputId);

  // ---- Build viewport (pre + textarea) -------------------------------------

  const viewport = el('div', { class: 'vh-runner__viewport' });
  const textarea = el('textarea', {
    class: 'vh-runner__textarea',
    spellcheck: 'false',
    autocapitalize: 'off',
    autocorrect: 'off',
    'aria-label': 'Reproduction script editor',
  }) as HTMLTextAreaElement;
  textarea.value = opts.baselineSource;

  // Lift the existing `<pre>` into the viewport, then append the textarea.
  // CSS toggles which surface is visible based on `.vh-runner.is-editing`.
  const placeholder = document.createComment('vh-runner-mount');
  preParent.insertBefore(placeholder, preEl);
  viewport.append(preEl, textarea);

  // ---- Build action group (Edit / Run / Reset) -----------------------------

  const editBtn = el(
    'button',
    {
      type: 'button',
      class: 'vh-runner__btn vh-runner__btn--ghost',
      'aria-label': 'Edit reproduction script',
    },
    el('span', { 'aria-hidden': 'true' }),
    'Edit',
  ) as HTMLButtonElement;
  editBtn.firstElementChild!.innerHTML = SVG_PENCIL;

  const runBtn = el(
    'button',
    {
      type: 'button',
      class: 'vh-runner__btn vh-runner__btn--primary',
      'aria-label': 'Run reproduction',
    },
    el('span', { 'aria-hidden': 'true' }),
    'Run',
  ) as HTMLButtonElement;
  runBtn.firstElementChild!.innerHTML = SVG_PLAY;

  const resetBtn = el(
    'button',
    {
      type: 'button',
      class: 'vh-runner__btn vh-runner__btn--ghost',
      'aria-label': 'Reset to default',
    },
    el('span', { 'aria-hidden': 'true' }),
    'Reset',
  ) as HTMLButtonElement;
  resetBtn.firstElementChild!.innerHTML = SVG_RESET;

  const actions = el(
    'div',
    { class: 'vh-runner__actions' },
    editBtn,
    runBtn,
    resetBtn,
  );

  // ---- Status line ---------------------------------------------------------

  const statusEl = el('p', {
    class: 'vh-runner__status',
    role: 'status',
    'aria-live': 'polite',
  });

  // ---- Mount: head row (h2 + actions) + viewport + status ------------------
  // colEl + h2El were captured above, before we moved <pre>.

  if (h2El?.parentElement) {
    const headRow = el('div', { class: 'vh-runner__head' });
    h2El.parentElement.insertBefore(headRow, h2El);
    headRow.append(h2El, actions);
  } else {
    // Fallback — append actions before the viewport.
    viewport.parentElement?.insertBefore(actions, viewport);
  }

  // Build the runner shell and place it where the original `<pre>` lived.
  const shell = el(
    'div',
    { class: 'vh-runner', id: `vh-runner-${opts.slug}` },
    viewport,
    statusEl,
  );

  preParent.insertBefore(shell, placeholder);
  placeholder.remove();

  // ---- State + behaviour --------------------------------------------------

  let isEditing = false;
  let isBusy = false;

  const updateEditButtonLabel = (): void => {
    editBtn.textContent = '';
    const span = el('span', { 'aria-hidden': 'true' });
    span.innerHTML = isEditing ? SVG_EYE : SVG_PENCIL;
    editBtn.append(span, isEditing ? 'View' : 'Edit');
    editBtn.setAttribute(
      'aria-label',
      isEditing ? 'View highlighted source' : 'Edit reproduction script',
    );
  };

  const setEditing = (next: boolean): void => {
    isEditing = next;
    shell.classList.toggle('is-editing', next);
    updateEditButtonLabel();
    if (next) {
      // When entering edit mode, focus the textarea so the visitor
      // can start typing without an extra click.
      textarea.focus();
      const len = textarea.value.length;
      textarea.setSelectionRange(len, len);
    }
  };

  const setBusy = (next: boolean): void => {
    isBusy = next;
    runBtn.disabled = next;
    resetBtn.disabled = next;
    editBtn.disabled = next;
    runBtn.textContent = '';
    const span = el('span', { 'aria-hidden': 'true' });
    span.innerHTML = SVG_PLAY;
    runBtn.append(span, next ? 'Running…' : 'Run');
  };

  const setStatus = (text: string, kind: 'info' | 'ok' | 'error'): void => {
    statusEl.textContent = text;
    statusEl.classList.remove(
      'vh-runner__status--ok',
      'vh-runner__status--error',
    );
    if (kind === 'ok') statusEl.classList.add('vh-runner__status--ok');
    if (kind === 'error') statusEl.classList.add('vh-runner__status--error');
  };

  const currentSource = (): string =>
    isEditing ? textarea.value : opts.baselineSource;

  const runOnce = async (source: string): Promise<void> => {
    if (isBusy) return;
    setBusy(true);
    setStatus('Running reproduction…', 'info');
    setVerdict('pending', 'Re-running reproduction script…');
    try {
      const run = await opts.runFix(source);
      if (outputEl) outputEl.textContent = run.stdout || '(no output)';
      setVerdict(run.verdict, run.message);
      setStatus(`${run.verdict} — ${run.message}`, 'ok');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(`Run failed: ${message}`, 'error');
      setVerdict('unreproduced', `runtime error: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  // ---- Wire ---------------------------------------------------------------

  editBtn.addEventListener('click', () => {
    if (isBusy) return;
    setEditing(!isEditing);
  });

  runBtn.addEventListener('click', () => {
    void runOnce(currentSource());
  });

  resetBtn.addEventListener('click', () => {
    if (isBusy) return;
    textarea.value = opts.baselineSource;
    setEditing(false);
    setStatus('Reset to default — re-running baseline…', 'info');
    void runOnce(opts.baselineSource);
  });

  // Initial paint of buttons (the textContent shuffle inside set*())
  setEditing(false);
  setBusy(false);
  setStatus('', 'info');
}
