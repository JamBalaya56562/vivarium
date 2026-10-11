import { pick } from '../_shared/i18n.js';
import {
  DEFAULT_TERRARIUM_VERSION,
  loadTerrarium,
  type TerrariumTerminal,
} from '../_shared/terrarium_loader.js';
import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from '../_shared/verdict.js';

const FIXTURE = 'biome-migrate-prettier';
const BASELINE = {
  ref: 'migrate-prettier-before',
  commit: '2405c7620169bd0719166af09a8d89cc76fb37fb',
};
const FIX = {
  ref: 'migrate-prettier-after',
  commit: 'f79f85d58ae499647c127f1e90a4931e3dbbb206',
};
const UPSTREAM_URL = 'https://github.com/biomejs/biome/issues/12265';
const S = pick(
  {
    running: 'Running the same Prettier migration in both terminals…',
    reproduced:
      'bug reproduced — omitted Prettier defaults become asNeeded and single.',
    absent:
      'bug not reproduced — the baseline did not produce asNeeded and single.',
    error: 'Comparison failed',
  },
  {
    running: '同じ Prettier 移行を両方のターミナルで実行中…',
    reproduced:
      'bug reproduced — 省略された Prettier の既定値が asNeeded と single になる。',
    absent:
      'bug not reproduced — baseline は asNeeded と single を出力しなかった。',
    error: '比較に失敗した',
  },
);

interface Configuration {
  javascript?: { formatter?: { semicolons?: string; quoteStyle?: string } };
}

interface SessionResult {
  ref: string;
  commit: string;
  input: { prettier: unknown; biome: unknown };
  commands: { command: string; code: number; output: string }[];
  configuration: Configuration;
  reproduced: boolean;
  corrected: boolean;
}

const baselinePane = document.getElementById('output-baseline');
const fixPane = document.getElementById('output-fix');
const meta = document.getElementById('meta');
if (!baselinePane || !fixPane || !meta)
  throw new Error('Missing comparison elements');

function parseJson(output: string): unknown {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal output includes ANSI escapes
  return JSON.parse(output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim());
}

function isEmptyConfiguration(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

async function runSession(
  terminal: TerrariumTerminal,
  expected: typeof BASELINE,
): Promise<SessionResult> {
  const { tool, ref, commit } = await terminal.ready;
  if (tool !== 'biome' || ref !== expected.ref || commit !== expected.commit) {
    throw new Error(
      `Unexpected source: ${tool} ${ref} ${commit}; expected ${expected.commit}`,
    );
  }
  const commands: SessionResult['commands'] = [];
  async function run(command: string): Promise<string> {
    const result = await terminal.run(command);
    commands.push(result);
    if (result.code !== 0)
      throw new Error(`${ref}: ${command} exited ${result.code}`);
    return result.output;
  }
  const input = {
    prettier: parseJson(await run('cat .prettierrc')),
    biome: parseJson(await run('cat biome.json')),
  };
  if (
    !isEmptyConfiguration(input.prettier) ||
    !isEmptyConfiguration(input.biome)
  ) {
    throw new Error(`${ref}: expected empty Prettier and Biome configurations`);
  }
  await run('biome migrate prettier --write');
  const configuration = parseJson(
    await run('cat biome.json'),
  ) as Configuration | null;
  const formatter = configuration?.javascript?.formatter;
  if (!formatter?.semicolons || !formatter.quoteStyle) {
    throw new Error(
      `${ref}: migrated JavaScript formatter options are missing`,
    );
  }
  return {
    ref,
    commit,
    input,
    commands,
    configuration: configuration as Configuration,
    reproduced:
      formatter.semicolons === 'asNeeded' && formatter.quoteStyle === 'single',
    corrected:
      formatter.semicolons === 'always' && formatter.quoteStyle === 'double',
  };
}

const startedAt = new Date();
let baseline: SessionResult | null = null;
let fix: SessionResult | null = null;
let baselineError: string | null = null;
let fixError: string | null = null;

function record(version: string): void {
  const finishedAt = new Date();
  const envelope: VivariumResultV1 = {
    contract: 'v1',
    bug: { project: 'biome', issue: 12265, upstream_url: UPSTREAM_URL },
    runtime: {
      name: 'terrarium',
      version,
      extras: {
        fixture: FIXTURE,
        biome: BASELINE.commit,
        biome_fix_candidate: FIX.commit,
      },
    },
    result: {
      baseline,
      fix_candidate: fix,
      baseline_error: baselineError,
      fix_error: fixError,
    },
    timing: {
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    },
  };
  setResult(envelope);
}

try {
  const { terrariumVersion, createTerminal } = await loadTerrarium();
  const before = createTerminal({
    tool: 'biome',
    ref: BASELINE.ref,
    fixture: FIXTURE,
  });
  const after = createTerminal({
    tool: 'biome',
    ref: FIX.ref,
    fixture: FIXTURE,
  });
  baselinePane.replaceChildren(before);
  fixPane.replaceChildren(after);
  setVerdict('pending', S.running, 'running');

  const fixSession = runSession(after, FIX).then(
    (session) => {
      fix = session;
      fixPane.dataset.fixStatus = session.corrected ? 'ok' : 'error';
      if (!session.corrected)
        fixError = 'Candidate did not produce always and double';
    },
    (error: unknown) => {
      fixError = String(error);
      fixPane.dataset.fixStatus = 'error';
    },
  );
  try {
    baseline = await runSession(before, BASELINE);
    setVerdict(
      baseline.reproduced ? 'reproduced' : 'unreproduced',
      baseline.reproduced ? S.reproduced : S.absent,
    );
  } catch (error: unknown) {
    baselineError = String(error);
    setVerdict('unreproduced', `${S.error}: ${baselineError}`);
  }
  record(terrariumVersion);
  await fixSession;
  meta.textContent =
    `Biome ${BASELINE.commit.slice(0, 8)} → ${FIX.commit.slice(0, 8)} · ${FIXTURE}` +
    (baselineError || fixError
      ? ` · ${S.error}: ${baselineError ?? fixError}`
      : '');
  record(terrariumVersion);
} catch (error: unknown) {
  baselineError = String(error);
  fixError = baselineError;
  baselinePane.textContent = `${S.error}: ${baselineError}`;
  fixPane.textContent = `${S.error}: ${baselineError}`;
  fixPane.dataset.fixStatus = 'error';
  setVerdict('unreproduced', `${S.error}: ${baselineError}`);
  record(DEFAULT_TERRARIUM_VERSION);
}
