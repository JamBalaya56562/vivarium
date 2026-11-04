import { describe, expect, test } from 'bun:test';
import {
  buildEnvelope,
  COMMANDS,
  COMMIT_TIMESTAMP,
  type CommandResult,
  type CommandRunner,
  decide,
  existingCommit,
  type Outcome,
  parentCommit,
  RETRY_COMMAND,
  runSession,
  SessionError,
  settle,
} from './verdict.ts';

const ESC = String.fromCharCode(27);
const REWRITTEN = '0f256acf72e7123968a72827d84f17bc46c1706e';
const DESCRIBED =
  'Rebased 1 descendant commits.\nWorking copy  (@) now at: ksunpmlp 7e2f9cf7 (empty) B\nParent commit (@-)      : rvnuuxxz 0f256acf (empty) NEW\n';
const ALREADY_EXISTS = `Internal error: Unexpected error from backend\nCaused by: Newly-created commit ${REWRITTEN} already exists\n`;

function runner(
  retry: Partial<CommandResult>,
  overrides: Partial<Record<string, Partial<CommandResult>>> = {},
): CommandRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async run(command) {
      const first = !calls.includes(RETRY_COMMAND);
      calls.push(command);
      const base: CommandResult = {
        command,
        code: 0,
        output: command === RETRY_COMMAND ? DESCRIBED : '',
      };
      if (command === RETRY_COMMAND && !first) return { ...base, ...retry };
      return { ...base, ...overrides[command] };
    },
  };
}

async function failure(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(SessionError);
    return (error as Error).message;
  }
  throw new Error('expected a SessionError');
}

describe('output parsing', () => {
  test('reads the parent commit jj prints after a rewrite', () => {
    expect(parentCommit(DESCRIBED)).toBe('0f256acf');
    expect(parentCommit(`${ESC}[1m${DESCRIBED}${ESC}[0m`)).toBe('0f256acf');
    expect(parentCommit('Nothing changed.\n')).toBeNull();
  });

  test('reads the commit the backend reports as already existing', () => {
    expect(existingCommit(ALREADY_EXISTS)).toBe(REWRITTEN);
    expect(existingCommit('Internal error: something else\n')).toBeNull();
  });
});

describe('runSession', () => {
  test('pins the commit timestamp on every command', () => {
    for (const command of [...COMMANDS, RETRY_COMMAND])
      expect(command).toStartWith(`JJ_TIMESTAMP=${COMMIT_TIMESTAMP} jj `);
    expect(COMMANDS.at(-1)).toEndWith(' jj undo');
  });

  test('a retry rejected as already existing is reproduced', async () => {
    const run = runner({ code: 255, output: ALREADY_EXISTS });
    const session = await runSession('baseline', run);
    expect(run.calls).toEqual([...COMMANDS, RETRY_COMMAND]);
    expect(session.reproduced).toBe(true);
    expect(session.corrected).toBe(false);
    expect(session.rewrittenParent).toBe('0f256acf');
    expect(session.existingCommit).toBe(REWRITTEN);
    expect(session.retryCode).toBe(255);
  });

  test('a retry that re-creates the same parent is corrected', async () => {
    const session = await runSession(
      'fix',
      runner({ code: 0, output: DESCRIBED }),
    );
    expect(session.corrected).toBe(true);
    expect(session.reproduced).toBe(false);
    expect(session.existingCommit).toBeNull();
  });

  test('a recorded command that fails stops the session', async () => {
    const undo = COMMANDS.at(-1) ?? '';
    const run = runner({}, { [undo]: { code: 1 } });
    expect(await failure(runSession('baseline', run))).toBe(
      `baseline: ${undo} exited 1`,
    );
    expect(run.calls.at(-1)).toBe(undo);
  });

  test('a first rewrite without a parent commit is an error', async () => {
    const run = runner(
      {},
      { [RETRY_COMMAND]: { output: 'Nothing changed.\n' } },
    );
    expect(await failure(runSession('baseline', run))).toBe(
      `baseline: the first ${RETRY_COMMAND} printed no parent commit`,
    );
  });

  test('a retry that fails for another reason is an error', async () => {
    expect(
      await failure(
        runSession(
          'baseline',
          runner({ code: 255, output: 'Internal error: lock\n' }),
        ),
      ),
    ).toBe(
      `baseline: the retried ${RETRY_COMMAND} exited 255 without naming 0f256acf as already existing`,
    );
    const other = ALREADY_EXISTS.replace(REWRITTEN, 'f'.repeat(40));
    expect(
      await failure(
        runSession('baseline', runner({ code: 255, output: other })),
      ),
    ).toContain('without naming 0f256acf');
  });

  test('a retry that succeeds with another parent is an error', async () => {
    const moved = DESCRIBED.replace('0f256acf', '12345678');
    expect(
      await failure(runSession('fix', runner({ code: 0, output: moved }))),
    ).toBe(`fix: the retried ${RETRY_COMMAND} did not re-create 0f256acf`);
  });
});

describe('decide', () => {
  const reproduced = settle(
    runSession('baseline', runner({ code: 255, output: ALREADY_EXISTS })),
  );
  const corrected = settle(
    runSession('fix', runner({ code: 0, output: DESCRIBED })),
  );
  const broken: Outcome = {
    ok: false,
    error: 'baseline: jj git init exited 1',
  };

  test('the verdict follows the baseline and the fix is checked apart', async () => {
    const decision = decide(await reproduced, await corrected);
    expect(decision).toEqual({
      verdict: 'reproduced',
      fixStatus: 'ok',
      baselineError: null,
      fixError: null,
      baselineCorrected: false,
    });
  });

  test('a fix that still fails is a fix error, not a verdict change', async () => {
    const fix = await settle(
      runSession('fix', runner({ code: 255, output: ALREADY_EXISTS })),
    );
    const decision = decide(await reproduced, fix);
    expect(decision.verdict).toBe('reproduced');
    expect(decision.fixStatus).toBe('error');
    expect(decision.fixError).toBe(
      `fix: ${RETRY_COMMAND} still fails after jj undo`,
    );
  });

  test('a baseline error is unreproduced and carries the error', async () => {
    const decision = decide(broken, await corrected);
    expect(decision.verdict).toBe('unreproduced');
    expect(decision.baselineError).toBe('baseline: jj git init exited 1');
  });

  test('a corrected baseline is unreproduced and flagged', async () => {
    const decision = decide(await corrected, await corrected);
    expect(decision.verdict).toBe('unreproduced');
    expect(decision.baselineCorrected).toBe(true);
  });
});

describe('buildEnvelope', () => {
  test('records the guests, the pinned timestamp and the timing', async () => {
    const baseline = await settle(
      runSession('baseline', runner({ code: 255, output: ALREADY_EXISTS })),
    );
    const fix = await settle(
      runSession('fix', runner({ code: 0, output: DESCRIBED })),
    );
    const envelope = buildEnvelope({
      decision: decide(baseline, fix),
      baseline: baseline.ok ? baseline.session : null,
      fix: fix.ok ? fix.session : null,
      upstreamUrl: 'https://github.com/jj-vcs/jj/issues/10189',
      packageVersion: '0.12.0',
      packSha256: 'a'.repeat(64),
      guests: {
        baseline: { commit: 'b'.repeat(40), buildKey: 'c'.repeat(64) },
        fix: { commit: 'd'.repeat(40), buildKey: 'e'.repeat(64) },
      },
      startedAt: new Date('2026-11-01T00:00:00Z'),
      finishedAt: new Date('2026-11-01T00:00:02Z'),
    });
    expect(envelope.bug).toEqual({
      project: 'jj',
      issue: 10189,
      upstream_url: 'https://github.com/jj-vcs/jj/issues/10189',
    });
    expect(envelope.runtime.extras).toEqual({
      commit_timestamp: COMMIT_TIMESTAMP,
      baseline_commit: 'b'.repeat(40),
      baseline_build_key: 'c'.repeat(64),
      fix_commit: 'd'.repeat(40),
      fix_build_key: 'e'.repeat(64),
      pack_sha256: 'a'.repeat(64),
    });
    expect(envelope.timing.duration_ms).toBe(2000);
  });
});
