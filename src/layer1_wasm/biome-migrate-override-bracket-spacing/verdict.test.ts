import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  buildEnvelope,
  COMMANDS,
  type CommandResult,
  type CommandRunner,
  canonicalJson,
  commandSha256,
  decide,
  fixtureSha256,
  type Outcome,
  readOverrideBracketSpacing,
  runSession,
  SessionError,
  settle,
  stripAnsi,
} from './verdict.ts';

const PRETTIERRC =
  '{"overrides":[{"files":["*.js"],"options":{"bracketSpacing":false}}]}\n';
const ESC = String.fromCharCode(27);

function migrated(override: Record<string, unknown> | null): string {
  return JSON.stringify(
    {
      $schema: 'https://biomejs.dev/schemas/2.5.0/schema.json',
      overrides: override === null ? [] : [{ includes: ['*.js'], ...override }],
    },
    null,
    2,
  );
}

function runner(
  outputs: Partial<Record<string, Partial<CommandResult>>> = {},
  migratedOutput = migrated({}),
): CommandRunner & { calls: string[] } {
  const calls: string[] = [];
  let catBiome = 0;
  return {
    calls,
    async run(command) {
      calls.push(command);
      const defaults: Record<string, string> = {
        'cat .prettierrc': PRETTIERRC,
        'biome migrate prettier --write': 'Configuration migrated.\n',
      };
      let output = defaults[command] ?? '';
      if (command === 'cat biome.json') {
        catBiome += 1;
        output = catBiome === 1 ? '{}\n' : migratedOutput;
      }
      return { command, code: 0, output, ...outputs[command] };
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

describe('readOverrideBracketSpacing (BR4.3)', () => {
  test('reads formatter.bracketSpacing and javascript.formatter.bracketSpacing', () => {
    expect(
      readOverrideBracketSpacing(
        JSON.parse(migrated({ formatter: { bracketSpacing: false } })),
      ),
    ).toEqual({ value: false, corrected: true });
    expect(
      readOverrideBracketSpacing(
        JSON.parse(
          migrated({ javascript: { formatter: { bracketSpacing: false } } }),
        ),
      ),
    ).toEqual({ value: false, corrected: true });
    expect(
      readOverrideBracketSpacing(
        JSON.parse(migrated({ formatter: { indentStyle: 'space' } })),
      ),
    ).toEqual({ value: null, corrected: false });
  });

  test('refuses a configuration without the *.js override', () => {
    expect(() =>
      readOverrideBracketSpacing(JSON.parse(migrated(null))),
    ).toThrow('no override for ["*.js"]');
    expect(() =>
      readOverrideBracketSpacing({
        overrides: [{ includes: ['**/*.js'], formatter: {} }],
      }),
    ).toThrow(SessionError);
    expect(() => readOverrideBracketSpacing([])).toThrow(SessionError);
  });
});

describe('runSession (BR4.1, BR4.2)', () => {
  test('runs the commands in order and reports a dropped option as reproduced', async () => {
    const terminal = runner();
    const session = await runSession('baseline', terminal, {
      prettierrc: PRETTIERRC,
    });
    expect(terminal.calls).toEqual([...COMMANDS]);
    expect(session).toMatchObject({
      role: 'baseline',
      overrideBracketSpacing: null,
      reproduced: true,
      corrected: false,
    });
    expect(session.commands.map((c) => c.command)).toEqual([...COMMANDS]);
  });

  test('reads the corrected option through ANSI escapes and CRLF', async () => {
    const coloured = `${ESC}[1m${migrated({ formatter: { bracketSpacing: false } }).replace(/\n/g, '\r\n')}${ESC}[0m\r\n`;
    const session = await runSession('fix', runner({}, coloured), {
      prettierrc: PRETTIERRC,
    });
    expect(session).toMatchObject({ corrected: true, reproduced: false });
    expect(stripAnsi(`${ESC}[31mred${ESC}[0m`)).toBe('red');
  });

  test('fails on a changed fixture, a non-empty biome.json, a failed migrate and unparsable output', async () => {
    const fixture = { prettierrc: PRETTIERRC };
    expect(
      await failure(
        runSession(
          'baseline',
          runner({ 'cat .prettierrc': { output: '{}\n' } }),
          fixture,
        ),
      ),
    ).toBe('baseline: .prettierrc differs from the fixture');
    const nonEmpty = runner();
    let first = true;
    const original = nonEmpty.run.bind(nonEmpty);
    nonEmpty.run = async (command) => {
      const result = await original(command);
      if (command === 'cat biome.json' && first) {
        first = false;
        return { ...result, output: '{"formatter":{}}' };
      }
      return result;
    };
    expect(await failure(runSession('baseline', nonEmpty, fixture))).toBe(
      'baseline: biome.json is not {} before migrating',
    );
    expect(
      await failure(
        runSession(
          'fix',
          runner({ 'biome migrate prettier --write': { code: 1 } }),
          fixture,
        ),
      ),
    ).toBe('fix: biome migrate prettier --write exited 1');
    expect(
      await failure(
        runSession('fix', runner({}, 'error: unexpected token'), fixture),
      ),
    ).toBe('fix: migrated biome.json is not JSON');
    expect(
      await failure(runSession('fix', runner({}, migrated(null)), fixture)),
    ).toContain('fix: migrated biome.json has no override');
  });
});

function ok(corrected: boolean): Outcome {
  return {
    ok: true,
    session: {
      role: 'baseline',
      commands: [],
      configuration: {},
      overrideBracketSpacing: corrected ? false : null,
      reproduced: !corrected,
      corrected,
    },
  };
}

describe('decide (BR4.4, BR4.5)', () => {
  test('decides the verdict from the baseline alone', () => {
    expect(decide(ok(false), ok(true))).toEqual({
      verdict: 'reproduced',
      fixStatus: 'ok',
      baselineError: null,
      fixError: null,
      baselineCorrected: false,
    });
    expect(decide(ok(false), ok(false))).toMatchObject({
      verdict: 'reproduced',
      fixStatus: 'error',
      fixError: 'fix: the *.js override does not set bracketSpacing to false',
    });
  });

  test('records a corrected baseline as unreproduced, not as a pass', () => {
    expect(decide(ok(true), ok(true))).toEqual({
      verdict: 'unreproduced',
      fixStatus: 'ok',
      baselineError: null,
      fixError: null,
      baselineCorrected: true,
    });
  });

  test('turns a failure into an error, never a verdict', async () => {
    const failed = await settle(Promise.reject(new SessionError('boom')));
    expect(failed).toEqual({ ok: false, error: 'boom' });
    expect(decide(failed, failed)).toEqual({
      verdict: 'unreproduced',
      fixStatus: 'error',
      baselineError: 'boom',
      fixError: 'boom',
      baselineCorrected: false,
    });
  });
});

describe('digests (BR5.3)', () => {
  const encoder = new TextEncoder();
  const prettier = encoder.encode(PRETTIERRC);
  const biome = encoder.encode('{}\n');

  test('gives the same fixture digest for the same files in any order', async () => {
    const a = await fixtureSha256([
      { path: '.prettierrc', bytes: prettier },
      { path: 'biome.json', bytes: biome },
    ]);
    const b = await fixtureSha256([
      { path: 'biome.json', bytes: biome },
      { path: '.prettierrc', bytes: prettier },
    ]);
    expect(a).toBe(b);
    const sha = (bytes: Uint8Array | string) =>
      createHash('sha256').update(bytes).digest('hex');
    expect(a).toBe(
      sha(
        `[{"path":".prettierrc","sha256":"${sha(prettier)}"},{"path":"biome.json","sha256":"${sha(biome)}"}]`,
      ),
    );
    expect(
      await fixtureSha256([
        { path: '.prettierrc', bytes: prettier },
        { path: 'biome.json', bytes: encoder.encode('{ }\n') },
      ]),
    ).not.toBe(a);
  });

  test('gives a stable command digest that follows the order', async () => {
    expect(await commandSha256(COMMANDS)).toBe(
      await commandSha256([...COMMANDS]),
    );
    expect(await commandSha256([...COMMANDS].reverse())).not.toBe(
      await commandSha256(COMMANDS),
    );
  });

  test('normalizes like the build-info rule and refuses what it cannot', async () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'] })).toBe(
      '{"a":[true,null,"x"],"b":1}',
    );
    expect(() => canonicalJson({ a: 1.5 })).toThrow('safe integers');
    expect(() => canonicalJson('\uD800')).toThrow('lone surrogate');
    await expect(
      fixtureSha256([
        { path: 'a', bytes: biome },
        { path: 'a', bytes: biome },
      ]),
    ).rejects.toThrow('repeats a');
  });
});

describe('buildEnvelope (BR4.6)', () => {
  test('reports formicarium, the pinned version and the identities in extras', () => {
    const started = new Date('2026-10-19T00:00:00.000Z');
    const finished = new Date('2026-10-19T00:00:01.500Z');
    const envelope = buildEnvelope({
      decision: decide(ok(false), ok(true)),
      baseline: null,
      fix: null,
      upstreamUrl: 'https://github.com/biomejs/biome',
      packageVersion: '0.3.0',
      packSha256: 'p'.repeat(64),
      fixtureSha256: 'f'.repeat(64),
      guests: {
        baseline: { commit: 'a'.repeat(40), buildKey: 'b'.repeat(64) },
        fix: { commit: 'c'.repeat(40), buildKey: 'd'.repeat(64) },
      },
      startedAt: started,
      finishedAt: finished,
    });
    expect(envelope).toMatchObject({
      contract: 'v1',
      bug: { project: 'biome', issue: 0 },
      runtime: {
        name: 'formicarium',
        version: '0.3.0',
        extras: {
          fixture_sha256: 'f'.repeat(64),
          baseline_commit: 'a'.repeat(40),
          baseline_build_key: 'b'.repeat(64),
          fix_commit: 'c'.repeat(40),
          fix_build_key: 'd'.repeat(64),
          pack_sha256: 'p'.repeat(64),
        },
      },
      result: {
        baseline_error: null,
        fix_error: null,
        baseline_corrected: false,
      },
      timing: { duration_ms: 1500, started_at: '2026-10-19T00:00:00.000Z' },
    });
    for (const value of Object.values(envelope.runtime.extras))
      expect(typeof value).toBe('string');
  });
});
