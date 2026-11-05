import { describe, expect, test } from 'bun:test';
import { recipeSourceUrl } from '../../site/_components/recipe-url';

const source_url =
  'https://github.com/aletheia-works/vivarium/tree/main/src/layer3_previews/x';
const pull_url = 'https://github.com/o/r/pull/1';
const commit_url = 'https://github.com/o/r/commit/abc';
const preview_url = 'https://sign-in.example.com/x/';

describe('recipeSourceUrl', () => {
  test('a recipe with its own page links to its directory', () => {
    expect(recipeSourceUrl({ source_url })).toBe(source_url);
  });

  test('a preview links to its pull request', () => {
    expect(
      recipeSourceUrl({ preview_url, pull_url, commit_url, source_url }),
    ).toBe(pull_url);
  });

  test('a preview without a pull request links to its commit', () => {
    expect(recipeSourceUrl({ preview_url, commit_url, source_url })).toBe(
      commit_url,
    );
  });
});
