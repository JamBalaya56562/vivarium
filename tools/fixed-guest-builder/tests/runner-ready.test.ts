import { describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';

describe('runner ready', () => {
  test('runs under Bun with ES modules', () => {
    expect(typeof Bun.version).toBe('string');
    expect(import.meta.url.startsWith('file:')).toBe(true);
  });

  test('provides the YAML parser the workflow tests use', () => {
    expect(Bun.YAML.parse('a: 1')).toEqual({ a: 1 });
  });

  test("discovers tests only under this package's tests directory", async () => {
    const entries = await readdir(new URL('.', import.meta.url));
    expect(entries).toContain('runner-ready.test.ts');
  });
});
