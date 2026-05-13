#!/usr/bin/env bun
//
// Build-time codegen for ajv-standalone validators.
//
// Reads each schema under `docs/site/public/spec/` and emits a self-contained
// validator module under `docs/generated/`. The generated modules are
// gitignored — they are reproducible from the schema + this script + the
// pinned ajv / ajv-formats versions in package.json.
//
// Wired into `bun run dev` and `bun run build` via docs/package.json,
// ahead of `generate-index` so the rspress build never sees a stale
// validator. See ADR-0034 for the trust-the-trigger override that
// authorised this migration ahead of the original A3 trigger conditions.
//
// Adding a new schema → add an entry to `TARGETS` below; the rest of the
// pipeline picks it up.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import addFormats from 'ajv-formats';

interface Target {
  /** Path relative to docs/site/public/spec/. */
  schema: string;
  /** Output filename under docs/generated/. */
  output: string;
  /** Human-friendly name used in log lines. */
  label: string;
}

const TARGETS: Target[] = [
  {
    schema: 'manifest.schema.json',
    output: 'manifest-validator.mjs',
    label: 'Manifest v1',
  },
  {
    schema: 'verdict.schema.json',
    output: 'verdict-validator.mjs',
    label: 'Verdict v1 (Contract v1)',
  },
];

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(SCRIPT_DIR, '..');
const SCHEMA_DIR = join(DOCS_DIR, 'site', 'public', 'spec');
const OUTPUT_DIR = join(DOCS_DIR, 'generated');

mkdirSync(OUTPUT_DIR, { recursive: true });

for (const { schema, output, label } of TARGETS) {
  const schemaPath = join(SCHEMA_DIR, schema);
  const outputPath = join(OUTPUT_DIR, output);
  const schemaJson = JSON.parse(readFileSync(schemaPath, 'utf-8'));

  // Strict mode is on by default; the schemas use only documented
  // keywords (oneOf, not, format, const, enum) so no exceptions needed.
  // `code: { source: true, esm: true }` is required for standaloneCode.
  // `allErrors: true` lets the consumer surface every field error in
  // one pass instead of bailing on the first failure.
  const ajv = new Ajv2020({
    allErrors: true,
    code: { source: true, esm: true },
  });
  addFormats(ajv);

  const validate = ajv.compile(schemaJson);
  const moduleCode = standaloneCode(ajv, validate);

  writeFileSync(outputPath, moduleCode, 'utf-8');
  console.log(
    `[generate-validators] ${label}: ${schema} → generated/${output}`,
  );
}
