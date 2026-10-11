import { describe, expect, test } from 'bun:test';
import { publishedFixCommit } from '../../../src/layer1_wasm/scripts/bump-upstream';

const fix = {
  url: 'https://github.com/JamBalaya56562/biome',
  branch: 'fix/migrate-prettier-default-semi-quotes',
};
const commit = 'f79f85d58ae499647c127f1e90a4931e3dbbb206';
const source = {
  type: 'git-unmodified',
  url: fix.url,
  ref: fix.branch,
  commit,
};
const catalogue = (entry: unknown) => ({
  builds: { biome: { 'migrate-prettier-after': entry } },
});

describe('published Terrarium fix pins', () => {
  test('selects the published branch build, ignoring other selections', () => {
    expect(
      publishedFixCommit(
        {
          builds: {
            biome: {
              'migrate-prettier-before': {
                source: { ...source, ref: 'baseline', commit: 'a'.repeat(40) },
              },
              'migrate-prettier-after': { source },
            },
          },
        },
        fix,
      ),
    ).toBe(commit);
  });
  test('requires the declared repository, branch, source type and full commit', () => {
    for (const changed of [
      { url: 'https://github.com/other/biome' },
      { ref: 'main' },
      { type: 'patched' },
      { commit: 'f79f85d' },
      { commit: null },
    ]) {
      expect(() =>
        publishedFixCommit(
          catalogue({ source: { ...source, ...changed } }),
          fix,
        ),
      ).toThrow();
    }
  });
  test('rejects missing and ambiguous builds', () => {
    for (const value of [null, {}, { builds: {} }, catalogue({})]) {
      expect(() => publishedFixCommit(value, fix)).toThrow();
    }
    expect(() =>
      publishedFixCommit(
        { builds: { biome: { first: { source }, second: { source } } } },
        fix,
      ),
    ).toThrow();
  });
});
