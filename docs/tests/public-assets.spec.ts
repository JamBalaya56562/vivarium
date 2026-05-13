// Public machine-readable endpoints and static assets served from docs/doc_build.
//
// `bun run build` lets rspress copy docs/site/public into doc_build so
// GitHub Pages can serve /api/*.json, /spec/*.schema.json, and favicon
// assets unchanged under /vivarium/. These checks catch the failure mode
// where the human docs build succeeds but public assets are missing from
// the deployed artifact.

import { expect, test } from '@playwright/test';

interface JsonEndpointCase {
  url: string;
  assert: (body: unknown) => void;
}

interface StaticAssetCase {
  url: string;
  contentType?: RegExp;
  minBytes: number;
}

const jsonEndpoints: JsonEndpointCase[] = [
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

const staticAssets: StaticAssetCase[] = [
  {
    url: '/vivarium/favicon.ico',
    minBytes: 100,
  },
  {
    url: '/vivarium/favicon-32x32.png',
    contentType: /^image\/png\b/i,
    minBytes: 100,
  },
  {
    url: '/vivarium/apple-touch-icon.png',
    contentType: /^image\/png\b/i,
    minBytes: 100,
  },
  {
    url: '/vivarium/icon-192.png',
    contentType: /^image\/png\b/i,
    minBytes: 100,
  },
];

test.describe('docs site — public JSON endpoints', () => {
  for (const { url, assert } of jsonEndpoints) {
    test(`${url} is present in doc_build`, async ({ request }) => {
      const response = await request.get(url);
      expect(response.status(), `status for ${url}`).toBe(200);

      const body = await response.json();
      assert(body);
    });
  }
});

test.describe('docs site — public static assets', () => {
  for (const { url, contentType, minBytes } of staticAssets) {
    test(`${url} is present in doc_build`, async ({ request }) => {
      const response = await request.get(url);
      expect(response.status(), `status for ${url}`).toBe(200);
      if (contentType) {
        expect(response.headers()['content-type'] ?? '').toMatch(contentType);
      }

      const body = await response.body();
      expect(body.length, `byte length for ${url}`).toBeGreaterThan(minBytes);
    });
  }
});
