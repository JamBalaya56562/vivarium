import { describe, expect, test } from 'bun:test';
import { localScript, mergeCoverage, parseLcov } from './u6-coverage.ts';

const denominator = { minLineCoverage: 80, files: ['a.ts', 'b.ts'] };

function hits(entries: Record<string, [number, number][]>) {
  return new Map(
    Object.entries(entries).map(([path, lines]) => [path, new Map(lines)]),
  );
}

describe('u6-coverage', () => {
  test('reads lcov line hits relative to the repository', () => {
    const lcov = parseLcov(
      'SF:a.ts\nDA:1,1\nDA:2,0\nend_of_record\nSF:b.ts\nDA:3,4\nend_of_record\n',
      '/repo',
    );
    expect([...(lcov.get('a.ts') ?? [])]).toEqual([
      [1, 1],
      [2, 0],
    ]);
    expect(lcov.get('b.ts')?.get(3)).toBe(4);
  });

  test('counts a line hit by bun or by the browser, on the bun line set', () => {
    const report = mergeCoverage(
      denominator,
      hits({
        'a.ts': [
          [1, 0],
          [2, 0],
          [3, 1],
          [4, 1],
        ],
      }),
      hits({
        'a.ts': [[1, 1]],
        'b.ts': [
          [1, 1],
          [2, 1],
          [3, 1],
          [4, 1],
          [5, 1],
        ],
      }),
      true,
    );
    expect(report.files).toEqual([
      { path: 'a.ts', lines: 4, hit: 3, sources: ['bun', 'chromium'] },
      { path: 'b.ts', lines: 5, hit: 5, sources: ['chromium'] },
    ]);
    expect(report).toMatchObject({ status: 'passed', percent: 88.89 });
  });

  test('fails below the floor and when a file is not measured', () => {
    const low = mergeCoverage(
      denominator,
      hits({
        'a.ts': [
          [1, 0],
          [2, 1],
        ],
        'b.ts': [[1, 1]],
      }),
      new Map(),
      true,
    );
    expect(low.status).toBe('failed');
    expect(low.reason).toContain('below 80%');
    const missing = mergeCoverage(
      denominator,
      hits({ 'a.ts': [[1, 1]] }),
      new Map(),
      true,
    );
    expect(missing.status).toBe('failed');
    expect(missing.missing).toEqual(['b.ts']);
  });

  test('reports a pending recipe as not measured, never as passed', () => {
    const report = mergeCoverage(
      denominator,
      hits({ 'a.ts': [[1, 1]], 'b.ts': [[1, 1]] }),
      new Map(),
      false,
    );
    expect(report.status).toBe('not-measured');
    expect(report.reason).toContain('this is not a pass');
  });

  test('maps served URLs back to the Layer 1 sources', () => {
    expect(
      localScript(
        'http://localhost:8769/vivarium/ja/repro/biome/_shared/formicarium_terminal.js',
      ) ?? '',
    ).toMatch(/src\/layer1_wasm\/_shared\/formicarium_terminal\.js$/);
    expect(localScript('http://localhost:8769/other/x.js')).toBeNull();
  });
});
