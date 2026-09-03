import '../_assets/chrome.js';

export type VerdictState = 'pending' | 'reproduced' | 'unreproduced';

export interface VivariumResultV1Bug {
  project: string;
  issue: number;
  upstream_url: string;
}

export interface VivariumResultV1Runtime {
  name: string;
  version: string;
  extras: Record<string, string>;
}

export interface VivariumResultV1Timing {
  started_at: string;
  finished_at: string;
  duration_ms: number;
}

export interface VivariumResultV1 {
  contract: 'v1';
  bug: VivariumResultV1Bug;
  runtime: VivariumResultV1Runtime;
  result: Record<string, unknown>;
  timing: VivariumResultV1Timing;
}

declare global {
  // eslint-disable-next-line no-var
  var __VIVARIUM_VERDICT__: VerdictState | undefined;
  // eslint-disable-next-line no-var
  var __VIVARIUM_VERDICT_MESSAGE__: string | undefined;
  // eslint-disable-next-line no-var
  var __VIVARIUM_RESULT__: VivariumResultV1 | undefined;
}

export function setVerdict(
  state: VerdictState,
  text: string,
  phase?: 'loading' | 'running',
): void {
  const el = document.getElementById('verdict');
  if (!el) {
    throw new Error('vivarium contract v1: missing element with id="verdict".');
  }
  el.classList.remove('reproduced', 'unreproduced', 'pending');
  el.classList.add(state);
  el.dataset['verdict'] = state;
  let label: string;
  if (state === 'pending') {
    const resolved = phase ?? (/running/i.test(text) ? 'running' : 'loading');
    label = resolved === 'running' ? 'RUNNING…' : 'LOADING…';
  } else if (state === 'reproduced') {
    label = 'REPRODUCED';
  } else {
    label = 'UNREPRODUCED';
  }
  el.textContent = label;
  globalThis.__VIVARIUM_VERDICT__ = state;
  globalThis.__VIVARIUM_VERDICT_MESSAGE__ = text;

  if (state !== 'pending') {
    document.dispatchEvent(
      new CustomEvent('vh-progress', {
        detail: { stage: 'done', pct: 100, label: 'Reproduction complete.' },
      }),
    );
  }
}

export function setResult(envelope: VivariumResultV1): void {
  if (!envelope || envelope.contract !== 'v1') {
    throw new Error(
      `vivarium contract v1: setResult expected contract="v1", got ${
        envelope ? JSON.stringify(envelope.contract) : 'null'
      }.`,
    );
  }
  globalThis.__VIVARIUM_RESULT__ = envelope;
}
