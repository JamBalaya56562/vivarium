import { describe, expect, test } from 'bun:test';
import {
  normalizeRepositoryUrl,
  parseAllowlist,
  validateDeclaration,
} from '../src/declaration.ts';
import { BuildError } from '../src/errors.ts';

const allowlist = parseAllowlist({
  schemaVersion: 1,
  repositories: [
    'https://github.com/biomejs/biome',
    'https://github.com/jambalaya56562/biome',
  ],
});
const COMMIT = '2405c7620169bd0719166af09a8d89cc76fb37fb';
const base = {
  tool: 'biome',
  repository: 'https://github.com/biomejs/biome',
  commit: COMMIT,
  fixture: 'biome-12265',
};

function code(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof BuildError) return error.code;
    throw error;
  }
  return undefined;
}

describe('normalizeRepositoryUrl', () => {
  test('lowercases and strips a trailing .git and slash', () => {
    expect(
      normalizeRepositoryUrl('https://github.com/JamBalaya56562/Biome.git/'),
    ).toBe('https://github.com/jambalaya56562/biome');
    expect(normalizeRepositoryUrl('https://github.com/biomejs/biome/')).toBe(
      'https://github.com/biomejs/biome',
    );
  });

  test('refuses credentials, other hosts, ports, queries and fragments', () => {
    for (const url of [
      'https://user:token@github.com/biomejs/biome',
      'https://gitlab.com/biomejs/biome',
      'https://github.com:443/biomejs/biome',
      'https://github.com/biomejs/biome?ref=main',
      'https://github.com/biomejs/biome#main',
      'http://github.com/biomejs/biome',
      'git@github.com:biomejs/biome.git',
      'https://github.com/biomejs',
      'https://github.com/biomejs/biome/tree/main',
    ]) {
      expect(code(() => normalizeRepositoryUrl(url))).toBe('INVALID_INPUT');
    }
  });
});

describe('parseAllowlist', () => {
  test('refuses entries that are not already normalized or are duplicated', () => {
    expect(
      code(() =>
        parseAllowlist({
          schemaVersion: 1,
          repositories: ['https://github.com/BiomeJS/biome'],
        }),
      ),
    ).toBe('INVALID_INPUT');
    expect(
      code(() =>
        parseAllowlist({
          schemaVersion: 1,
          repositories: [
            'https://github.com/biomejs/biome',
            'https://github.com/biomejs/biome',
          ],
        }),
      ),
    ).toBe('INVALID_INPUT');
    expect(
      code(() => parseAllowlist({ schemaVersion: 2, repositories: [] })),
    ).toBe('INVALID_INPUT');
  });
});

describe('dependency repositories', () => {
  test('are kept apart from the repositories a guest may be declared from', () => {
    const withDependency = parseAllowlist({
      schemaVersion: 1,
      repositories: ['https://github.com/biomejs/biome'],
      dependencyRepositories: ['https://github.com/react/react'],
    });
    expect(withDependency.dependencyRepositories).toEqual([
      'https://github.com/react/react',
    ]);
    expect(
      code(() =>
        validateDeclaration(
          { ...base, repository: 'https://github.com/react/react' },
          withDependency,
        ),
      ),
    ).toBe('INVALID_INPUT');
    expect(
      code(() =>
        parseAllowlist({
          schemaVersion: 1,
          repositories: ['https://github.com/biomejs/biome'],
          dependencyRepositories: 'x',
        }),
      ),
    ).toBe('INVALID_INPUT');
  });
});

describe('validateDeclaration', () => {
  test('accepts an allowlisted repository in any equivalent spelling', () => {
    const result = validateDeclaration(
      {
        ...base,
        repository: 'https://github.com/JamBalaya56562/biome.git',
        commit: 'f79f85d58ae499647c127f1e90a4931e3dbbb206',
      },
      allowlist,
    );
    expect(result.repository).toBe('https://github.com/jambalaya56562/biome');
  });

  test('refuses a repository outside the allowlist', () => {
    expect(
      code(() =>
        validateDeclaration(
          { ...base, repository: 'https://github.com/someone/biome' },
          allowlist,
        ),
      ),
    ).toBe('INVALID_INPUT');
  });

  test('refuses short, uppercase or missing commits and branch-only declarations', () => {
    expect(
      code(() =>
        validateDeclaration(
          { ...base, commit: COMMIT.slice(0, 12) },
          allowlist,
        ),
      ),
    ).toBe('INVALID_INPUT');
    expect(
      code(() =>
        validateDeclaration(
          { ...base, commit: COMMIT.toUpperCase() },
          allowlist,
        ),
      ),
    ).toBe('INVALID_INPUT');
    const { commit: _omitted, ...branchOnly } = base;
    expect(
      code(() =>
        validateDeclaration(
          { ...branchOnly, reference: { branch: 'main' } },
          allowlist,
        ),
      ),
    ).toBe('INVALID_INPUT');
  });

  test('keeps reference for the record but does not let it replace the commit', () => {
    const result = validateDeclaration(
      { ...base, reference: { pr: 'biomejs/biome#12265', branch: 'main' } },
      allowlist,
    );
    expect(result.commit).toBe(COMMIT);
    expect(result.reference).toEqual({
      pr: 'biomejs/biome#12265',
      branch: 'main',
    });
  });

  test('refuses a missing fixture and a malformed tool name', () => {
    expect(
      code(() => validateDeclaration({ ...base, fixture: '' }, allowlist)),
    ).toBe('INVALID_INPUT');
    expect(
      code(() => validateDeclaration({ ...base, tool: 'Biome!' }, allowlist)),
    ).toBe('INVALID_INPUT');
    expect(code(() => validateDeclaration(null, allowlist))).toBe(
      'INVALID_INPUT',
    );
  });

  test('refuses a reference that is not an object', () => {
    expect(
      code(() =>
        validateDeclaration({ ...base, reference: 'main' }, allowlist),
      ),
    ).toBe('INVALID_INPUT');
    expect(
      code(() =>
        validateDeclaration({ ...base, reference: { branch: 1 } }, allowlist),
      ),
    ).toBe('INVALID_INPUT');
  });
});
