import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Glob } from 'bun';
import validateManifestRaw from '../../site/_generated/validators/manifest-validator.mjs';
import validateRecipeRaw from '../../site/_generated/validators/recipe-validator.mjs';
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
const validateRecipe = validateRecipeRaw as unknown as AjvValidateFn;

const SCHEMA_DIR = path.join(
  import.meta.dirname,
  '..',
  '..',
  'site',
  'public',
  'spec',
);

const REPO_ROOT = path.join(import.meta.dirname, '..', '..', '..');

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

describe('Recipe (schema_version 1) validator', () => {
  test('schema example validates', () => {
    const examples = loadSchemaExamples('recipe.schema.json');
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      const ok = validateRecipe(example);
      if (!ok) {
        console.error('Recipe example failed:', validateRecipe.errors);
      }
      expect(ok).toBe(true);
    }
  });

  test('every shipped recipe.json validates', () => {
    const glob = new Glob('src/layer*_*/**/recipe.json');
    const files = Array.from(glob.scanSync({ cwd: REPO_ROOT })).sort();
    expect(files.length).toBeGreaterThan(0);
    const failures: Array<{ file: string; errors: unknown }> = [];
    for (const rel of files) {
      const data = JSON.parse(readFileSync(path.join(REPO_ROOT, rel), 'utf-8'));
      const ok = validateRecipe(data);
      if (!ok) failures.push({ file: rel, errors: validateRecipe.errors });
    }
    if (failures.length > 0) {
      console.error('Recipe files that failed validation:', failures);
    }
    expect(failures).toEqual([]);
  });

  test('rejects schema_version != 1', () => {
    const ok = validateRecipe({
      schema_version: 2,
      language: 'python',
    });
    expect(ok).toBe(false);
    expect(validateRecipe.errors).toContainEqual(
      expect.objectContaining({
        keyword: 'const',
        instancePath: '/schema_version',
      }),
    );
  });

  test('rejects empty language', () => {
    const ok = validateRecipe({
      schema_version: 1,
      language: '',
    });
    expect(ok).toBe(false);
    expect(validateRecipe.errors).toContainEqual(
      expect.objectContaining({
        keyword: 'minLength',
        instancePath: '/language',
      }),
    );
  });

  test('rejects unknown expected_verdict value', () => {
    const ok = validateRecipe({
      schema_version: 1,
      language: 'python',
      expected_verdict: 'pass',
    });
    expect(ok).toBe(false);
    expect(validateRecipe.errors).toContainEqual(
      expect.objectContaining({
        keyword: 'enum',
        instancePath: '/expected_verdict',
      }),
    );
  });

  test('rejects unknown top-level property (additionalProperties: false)', () => {
    const ok = validateRecipe({
      schema_version: 1,
      language: 'python',
      unexpected_field: 'nope',
    });
    expect(ok).toBe(false);
    expect(validateRecipe.errors).toContainEqual(
      expect.objectContaining({
        keyword: 'additionalProperties',
      }),
    );
  });
});
