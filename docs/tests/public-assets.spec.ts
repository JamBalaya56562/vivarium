// Public machine-readable endpoints served from docs/doc_build.
//
// `bun run build` writes the rspress pages, then stages docs/public into
// doc_build so GitHub Pages can serve /api/*.json and /spec/*.schema.json.
// These checks catch the failure mode where the human docs build succeeds
// but public JSON endpoints are missing from the deployed artifact.

import { expect, test } from '@playwright/test';

interface EndpointCase {
  url: string;
  assert: (body: unknown) => void;
}

const endpoints: EndpointCase[] = [
  {
    url: '/vivarium/api/recipes.json',
    assert: (body) => {
      expect(body).toMatchObject({ index: 'v1', contract: 'v1' });
      expect((body as { recipes?: unknown }).recipes).toEqual(
        expect.any(Array),
      );
    },
  },
  {
    url: '/vivarium/api/recipes.schema.json',
    assert: (body) => {
      expect(body).toMatchObject({
        $id: 'https://aletheia-works.github.io/vivarium/api/recipes.schema.json',
      });
    },
  },
  {
    url: '/vivarium/api/projects.json',
    assert: (body) => {
      expect(body).toMatchObject({ index: 'v1' });
      expect((body as { projects?: unknown }).projects).toEqual(
        expect.any(Array),
      );
    },
  },
  {
    url: '/vivarium/spec/verdict.schema.json',
    assert: (body) => {
      expect(body).toMatchObject({
        $id: 'https://aletheia-works.github.io/vivarium/spec/verdict.schema.json',
      });
    },
  },
  {
    url: '/vivarium/spec/manifest.schema.json',
    assert: (body) => {
      expect(body).toMatchObject({
        $id: 'https://aletheia-works.github.io/vivarium/spec/manifest.schema.json',
      });
    },
  },
];

test.describe('docs site — public JSON endpoints', () => {
  for (const { url, assert } of endpoints) {
    test(`${url} is present in doc_build`, async ({ request }) => {
      const response = await request.get(url);
      expect(response.status(), `status for ${url}`).toBe(200);

      const body = await response.json();
      assert(body);
    });
  }
});
