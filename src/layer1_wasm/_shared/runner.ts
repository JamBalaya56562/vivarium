import { pick } from './i18n.js';
import type { PathACapturedRun } from './path_a.js';
import { setVerdict } from './verdict.js';

interface RunnerStrings {
  editorAria: string;
  edit: string;
  view: string;
  editAria: string;
  viewAria: string;
  run: string;
  runAria: string;
  running: string;
  reset: string;
  resetAria: string;
  runningStatus: string;
  rerunning: string;
  noOutput: string;
  runFailed: (message: string) => string;
  runtimeError: (message: string) => string;
  resetStatus: string;
}

const STRINGS: RunnerStrings = {
  editorAria: 'Reproduction script editor',
  edit: 'Edit',
  view: 'View',
  editAria: 'Edit reproduction script',
  viewAria: 'View highlighted source',
  run: 'Run',
  runAria: 'Run reproduction',
  running: 'Running…',
  reset: 'Reset',
  resetAria: 'Reset to default',
  runningStatus: 'Running reproduction…',
  rerunning: 'Re-running reproduction script…',
  noOutput: '(no output)',
  runFailed: (m) => `Run failed: ${m}`,
  runtimeError: (m) => `runtime error: ${m}`,
  resetStatus: 'Reset to default — re-running baseline…',
};

const STRINGS_JA: Partial<RunnerStrings> = {
  editorAria: '再現スクリプトのエディタ',
  edit: '編集',
  view: '表示',
  editAria: '再現スクリプトを編集する',
  viewAria: 'ハイライト表示に戻す',
  run: '実行',
  runAria: '再現を実行する',
  running: '実行中…',
  reset: 'リセット',
  resetAria: '初期状態に戻す',
  runningStatus: '再現を実行中…',
  rerunning: '再現スクリプトを再実行中…',
  noOutput: '(出力なし)',
  runFailed: (m) => `実行に失敗した: ${m}`,
  runtimeError: (m) => `runtime エラー: ${m}`,
  resetStatus: '初期状態に戻した — baseline を再実行中…',
};

const S = pick(STRINGS, STRINGS_JA);

export interface RunnerOptions {
  slug: string;
  baselineSource: string;
  runFix: (source: string) => Promise<PathACapturedRun>;
  codeBlockId?: string;
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

  const colEl = preEl.closest<HTMLElement>('.vh-main__col');
  const h2El = colEl?.querySelector('h2') ?? null;

  const outputEl = document.getElementById(outputId);

  const viewport = el('div', { class: 'vh-runner__viewport' });
  const textarea = el('textarea', {
    class: 'vh-runner__textarea',
    spellcheck: 'false',
    autocapitalize: 'off',
    autocorrect: 'off',
    'aria-label': S.editorAria,
  }) as HTMLTextAreaElement;
  textarea.value = opts.baselineSource;

  const placeholder = document.createComment('vh-runner-mount');
  preParent.insertBefore(placeholder, preEl);
  viewport.append(preEl, textarea);

  function button(
    key: 'edit' | 'run' | 'reset',
    variant: string,
    label: string,
    ariaLabel: string,
    svg: string,
  ): HTMLButtonElement {
    const existing = colEl?.querySelector<HTMLButtonElement>(
      `.vh-runner__btn[data-vh-runner="${key}"]`,
    );
    if (existing) {
      existing.setAttribute('aria-label', ariaLabel);
      return existing;
    }
    const made = el(
      'button',
      {
        type: 'button',
        class: `vh-runner__btn ${variant}`,
        'data-vh-runner': key,
        'aria-label': ariaLabel,
      },
      el('span', { 'aria-hidden': 'true' }),
      el('span', {}, label),
    ) as HTMLButtonElement;
    made.firstElementChild!.innerHTML = svg;
    return made;
  }

  const editBtn = button(
    'edit',
    'vh-runner__btn--ghost',
    S.edit,
    S.editAria,
    SVG_PENCIL,
  );
  const runBtn = button(
    'run',
    'vh-runner__btn--primary',
    S.run,
    S.runAria,
    SVG_PLAY,
  );
  const resetBtn = button(
    'reset',
    'vh-runner__btn--ghost',
    S.reset,
    S.resetAria,
    SVG_RESET,
  );

  const staticActions = colEl?.querySelector<HTMLElement>('.vh-runner__actions');
  const actions =
    staticActions ??
    el('div', { class: 'vh-runner__actions' }, editBtn, runBtn, resetBtn);

  const statusEl = el('p', {
    class: 'vh-runner__status',
    role: 'status',
    'aria-live': 'polite',
  });

  if (!actions.isConnected) {
    if (h2El?.parentElement) {
      const headRow = el('div', { class: 'vh-runner__head' });
      h2El.parentElement.insertBefore(headRow, h2El);
      headRow.append(h2El, actions);
    } else {
      viewport.parentElement?.insertBefore(actions, viewport);
    }
  }
  for (const btn of [editBtn, runBtn, resetBtn]) btn.disabled = false;

  const shell = el(
    'div',
    { class: 'vh-runner', id: `vh-runner-${opts.slug}` },
    viewport,
    statusEl,
  );

  preParent.insertBefore(shell, placeholder);
  placeholder.remove();

  let isEditing = false;
  let isBusy = false;

  const updateEditButtonLabel = (): void => {
    editBtn.textContent = '';
    const span = el('span', { 'aria-hidden': 'true' });
    span.innerHTML = isEditing ? SVG_EYE : SVG_PENCIL;
    editBtn.append(span, isEditing ? S.view : S.edit);
    editBtn.setAttribute(
      'aria-label',
      isEditing ? S.viewAria : S.editAria,
    );
  };

  const setEditing = (next: boolean): void => {
    isEditing = next;
    shell.classList.toggle('is-editing', next);
    updateEditButtonLabel();
    if (next) {
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
    runBtn.append(span, next ? S.running : S.run);
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
    setStatus(S.runningStatus, 'info');
    setVerdict('pending', S.rerunning, 'running');
    try {
      const run = await opts.runFix(source);
      if (outputEl) outputEl.textContent = run.stdout || S.noOutput;
      setVerdict(run.verdict, run.message);
      setStatus(`${run.verdict} — ${run.message}`, 'ok');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(S.runFailed(message), 'error');
      setVerdict('unreproduced', S.runtimeError(message));
    } finally {
      setBusy(false);
    }
  };

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
    setStatus(S.resetStatus, 'info');
    void runOnce(opts.baselineSource);
  });

  setEditing(false);
  setBusy(false);
  setStatus('', 'info');
}
