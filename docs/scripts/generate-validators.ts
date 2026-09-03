#!/usr/bin/env bun

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import addFormats from 'ajv-formats';
import { SITE_GENERATED_VALIDATORS_DIR, SITE_SPEC_DIR } from './site-paths';

interface Target {
  schema: string;
  output: string;
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
  {
    schema: 'roundtrip.schema.json',
    output: 'roundtrip-validator.mjs',
    label: 'Roundtrip (schema_version 1)',
  },
  {
    schema: 'recipe.schema.json',
    output: 'recipe-validator.mjs',
    label: 'Recipe (schema_version 1)',
  },
];

mkdirSync(SITE_GENERATED_VALIDATORS_DIR, { recursive: true });

for (const { schema, output, label } of TARGETS) {
  const schemaPath = join(SITE_SPEC_DIR, schema);
  const outputPath = join(SITE_GENERATED_VALIDATORS_DIR, output);
  const schemaJson = JSON.parse(readFileSync(schemaPath, 'utf-8'));

  const ajv = new Ajv2020({
    allErrors: true,
    code: { source: true, esm: true },
  });
  addFormats(ajv);

  const validate = ajv.compile(schemaJson);
  const moduleCode = standaloneCode(ajv, validate);

  writeFileSync(outputPath, moduleCode, 'utf-8');
  console.log(
    `[generate-validators] ${label}: ${schema} -> _generated/validators/${output}`,
  );
}
