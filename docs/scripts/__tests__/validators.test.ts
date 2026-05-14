// Unit tests for the ajv-standalone-generated validators used by
// `ManifestScaffolder.tsx` (Manifest v1) and `ReproCompare.tsx`
// (Verdict / Contract v1). See ADR-0034 for the migration rationale.
//
// The tests are deliberately small and read directly from the schema
// files: each schema's `examples` array MUST validate, and a hand-
// curated set of invalid fixtures MUST fail with the expected
// `instancePath`. If a future schema edit accidentally drops a
// constraint or breaks the bundled example, this suite catches it
// before the codegen output ships.
//
// The validators are imported from `docs/site/_generated/validators/`, which
// is gitignored — running this suite without first running
// `bun run generate-validators` (or `bun run dev` / `build`, both of
// which trigger codegen) returns a clear "no module found" error.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import validateManifestRaw from '../../site/_generated/validators/manifest-validator.mjs';
import validateVerdictRaw from '../../site/_generated/validators/verdict-validator.mjs';

interface AjvErrorObject {
  instancePath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
}

interface AjvValidateFn {
  (data: unknown): boolean;
  errors?: AjvErrorObject[] | null;
}

const validateManifest = validateManifestRaw as unknown as AjvValidateFn;
const validateVerdict = validateVerdictRaw as unknown as AjvValidateFn;

const SCHEMA_DIR = path.join(
  import.meta.dirname,
  '..',
  '..',
  'site',
  'public',
  'spec',
);

function loadSchemaExamples(filename: string): unknown[] {
  const schema = JSON.parse(
    readFileSync(path.join(SCHEMA_DIR, filename), 'utf-8'),
  );
  return Array.isArray(schema.examples) ? schema.examples : [];
}

describe('Manifest v1 validator', () => {
  test('schema example validates', () => {
    const examples = loadSchemaExamples('manifest.schema.json');
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      const ok = validateManifest(example);
      if (!ok) {
        console.error('Manifest example failed:', validateManifest.errors);
      }
      expect(ok).toBe(true);
    }
  });

  test('rejects missing required field (slug)', () => {
    const ok = validateManifest({
      manifest: 'v1',
      layer: 1,
      bug: { project: 'x', issue: 0, upstream_url: 'https://example.org/' },
      layer1: { page_url: 'https://example.org/' },
    });
    expect(ok).toBe(false);
    expect(validateManifest.errors).toContainEqual(
      expect.objectContaining({
        keyword: 'required',
        params: { missingProperty: 'slug' },
      }),
    );
  });

  test('rejects bad slug pattern', () => {
    const ok = validateManifest({
      manifest: 'v1',
      slug: 'BadSlug_Name',
      layer: 1,
      bug: { project: 'x', issue: 0, upstream_url: 'https://example.org/' },
      layer1: { page_url: 'https://example.org/' },
    });
    expect(ok).toBe(false);
    expect(validateManifest.errors).toContainEqual(
      expect.objectContaining({
        keyword: 'pattern',
        instancePath: '/slug',
      }),
    );
  });

  test('rejects layer 1 manifest carrying layer2 block (oneOf)', () => {
    const ok = validateManifest({
      manifest: 'v1',
      slug: 'good-slug',
      layer: 1,
      bug: { project: 'x', issue: 0, upstream_url: 'https://example.org/' },
      layer1: { page_url: 'https://example.org/' },
      layer2: { image: 'ghcr.io/example/x' },
    });
    expect(ok).toBe(false);
  });
});

describe('Verdict v1 (Contract v1) validator', () => {
  test('schema example validates', () => {
    const examples = loadSchemaExamples('verdict.schema.json');
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      const ok = validateVerdict(example);
      if (!ok) {
        console.error('Verdict example failed:', validateVerdict.errors);
      }
      expect(ok).toBe(true);
    }
  });

  test('rejects missing required field', () => {
    const ok = validateVerdict({
      contract: 'v1',
      verdict: 'reproduced',
      exit_code: 0,
      // image_tag missing
      image_digest: '',
      captured_at: '2026-04-27T03:44:39Z',
      stdout: '',
      stderr_tail: '',
    });
    expect(ok).toBe(false);
    expect(validateVerdict.errors).toContainEqual(
      expect.objectContaining({
        keyword: 'required',
        params: { missingProperty: 'image_tag' },
      }),
    );
  });

  test('rejects unknown verdict enum value (e.g. legacy "pass")', () => {
    const ok = validateVerdict({
      contract: 'v1',
      verdict: 'pass', // post-ADR-0029 rename, this should fail
      exit_code: 0,
      image_tag: 'x:1',
      image_digest: '',
      captured_at: '2026-04-27T03:44:39Z',
      stdout: '',
      stderr_tail: '',
    });
    expect(ok).toBe(false);
    expect(validateVerdict.errors).toContainEqual(
      expect.objectContaining({
        keyword: 'enum',
        instancePath: '/verdict',
      }),
    );
  });

  test('rejects malformed captured_at (not ISO-8601)', () => {
    const ok = validateVerdict({
      contract: 'v1',
      verdict: 'reproduced',
      exit_code: 0,
      image_tag: 'x:1',
      image_digest: '',
      captured_at: 'not-a-date',
      stdout: '',
      stderr_tail: '',
    });
    expect(ok).toBe(false);
    expect(validateVerdict.errors).toContainEqual(
      expect.objectContaining({
        keyword: 'format',
        instancePath: '/captured_at',
      }),
    );
  });
});
