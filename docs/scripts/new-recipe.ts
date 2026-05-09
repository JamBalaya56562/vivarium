#!/usr/bin/env bun

//
// Scaffold a new Layer 2 recipe directory from the template at
// `src/layer2_docker/_template/`. Substitutes Mustache-style
// placeholders (`{{SLUG}}`, `{{PROJECT}}`, `{{ISSUE}}`, `{{TITLE}}`,
// `{{ISSUE_URL}}`, `{{BASE_IMAGE}}`) and prints next-steps.
//
// Usage (via mise — preferred):
//   mise run recipes-new -- <project> <issue> [<title>] [--base <image>] [--repo <owner/repo>]
//
// Usage (direct):
//   cd docs && bun run scripts/new-recipe.ts -- <project> <issue> [<title>]
//
// Examples:
//   mise run recipes-new -- node 63041 "Intl.DateTimeFormat drops month with calendar:'iso8601'"
//   mise run recipes-new -- python 149578 "tarfile fails on empty PAX TAR" --base python:3.15-rc-slim
//   mise run recipes-new -- typescript 61717 "tsc --build --watch produces stray .js" \
//                          --repo microsoft/TypeScript --base node:24-slim
//
// The script intentionally does NOT touch docs/data/recipe-facets.json
// or docs/data/projects.json — those entries require human metadata
// judgement (severity, symptom, tags, project tagline, homepage). The
// next-steps banner reminds you to add those rows manually before
// committing.

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');

function usage(msg?: string): never {
  if (msg) console.error(`Error: ${msg}`);
  console.error('');
  console.error(
    'Usage: mise run recipes-new -- <project> <issue> [<title>] [--base <image>] [--repo <owner/repo>]',
  );
  console.error('');
  console.error('Examples:');
  console.error(
    '  mise run recipes-new -- node 63041 "Intl.DateTimeFormat drops month"',
  );
  console.error(
    '  mise run recipes-new -- python 149578 "tarfile empty PAX" --base python:3.15-rc-slim',
  );
  console.error(
    '  mise run recipes-new -- typescript 61717 "tsc --watch stray .js" --repo microsoft/TypeScript',
  );
  process.exit(1);
}

// Pull `--flag value` pairs out of argv; return the remaining
// positional arguments and the flag map.
function parseFlags(
  argv: string[],
  flags: ReadonlySet<string>,
): {
  positional: string[];
  flagMap: Record<string, string>;
} {
  const positional: string[] = [];
  const flagMap: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (flags.has(a)) {
      const val = argv[i + 1];
      if (!val) usage(`${a} requires a value`);
      flagMap[a.replace(/^--/, '')] = val;
      i++;
    } else {
      positional.push(a);
    }
  }
  return { positional, flagMap };
}

const { positional, flagMap } = parseFlags(
  process.argv.slice(2),
  new Set(['--base', '--repo']),
);
const baseImage = flagMap.base ?? 'TODO-set-base-image';
const ownerRepoOverride = flagMap.repo;

const [project, issueStr, ...titleParts] = positional;
if (!project) usage('missing <project>');
if (!issueStr) usage('missing <issue>');

const issue = Number.parseInt(issueStr, 10);
if (!Number.isFinite(issue) || issue <= 0)
  usage(`invalid issue number: ${issueStr}`);

const title = titleParts.join(' ').trim() || `${project} #${issue}`;

const slug = `${project}-${issue}`;
// Guard against project names that the slug parser in
// docs/scripts/generate-recipes-index.ts (parseSlug) would not
// resolve cleanly. The regex below is the strict subset that
// parses unambiguously to project + issue.
if (!/^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*-\d+$/.test(slug)) {
  usage(
    `generated slug "${slug}" is not parseable. <project> must be ` +
      'kebab-case ([a-z][a-z0-9]*(-[a-z][a-z0-9]*)*) and contain no ' +
      'trailing digits.',
  );
}

// Default upstream issue URL — typical convention is `<project>/<project>`
// (e.g. nodejs/node, python/cpython is overridden, etc.). Override with
// `--repo` when the canonical name differs.
function defaultRepoFor(p: string): string {
  switch (p) {
    case 'node':
      return 'nodejs/node';
    case 'cpython':
      return 'python/cpython';
    case 'typescript':
      return 'microsoft/TypeScript';
    case 'rust':
      return 'rust-lang/rust';
    case 'pandas':
      return 'pandas-dev/pandas';
    case 'numpy':
      return 'numpy/numpy';
    case 'php':
      return 'php/php-src';
    case 'ruby':
      return 'ruby/ruby';
    case 'regex':
      return 'rust-lang/regex';
    default:
      return `${p}/${p}`;
  }
}

const ownerRepo = ownerRepoOverride ?? defaultRepoFor(project);
const issueUrl = `https://github.com/${ownerRepo}/issues/${issue}`;

const recipeDir = join(REPO_ROOT, 'src', 'layer2_docker', slug);
const templateDir = join(REPO_ROOT, 'src', 'layer2_docker', '_template');

if (existsSync(recipeDir)) {
  usage(`recipe directory already exists: src/layer2_docker/${slug}`);
}
if (!existsSync(templateDir)) {
  usage('template directory missing: src/layer2_docker/_template');
}

await mkdir(recipeDir, { recursive: true });

const replacements: Record<string, string> = {
  '{{SLUG}}': slug,
  '{{PROJECT}}': project,
  '{{ISSUE}}': String(issue),
  '{{TITLE}}': title,
  '{{ISSUE_URL}}': issueUrl,
  '{{BASE_IMAGE}}': baseImage,
};

const files = await readdir(templateDir);
const written: string[] = [];
for (const f of files) {
  const src = join(templateDir, f);
  if (!(await stat(src)).isFile()) continue;
  let content = await readFile(src, 'utf-8');
  for (const [k, v] of Object.entries(replacements)) {
    content = content.replaceAll(k, v);
  }
  const dst = join(recipeDir, f);
  await writeFile(dst, content);
  written.push(`src/layer2_docker/${slug}/${f}`);
}

for (const path of written) console.log(`✓ ${path}`);
console.log('');
console.log(`Scaffolded src/layer2_docker/${slug}/ from _template/.`);
console.log('');
console.log('Next steps (per .claude/rules/recipe-authoring.md):');
console.log(
  `  1. Edit src/layer2_docker/${slug}/Dockerfile — set the real base image (current: ${baseImage}).`,
);
console.log(
  `  2. Edit src/layer2_docker/${slug}/repro.sh — replace the TODO stub with the real probe.`,
);
console.log(
  `  3. Edit src/layer2_docker/${slug}/README.md — fill in bug description, verdict contract, references.`,
);
console.log(
  `  4. Edit src/layer2_docker/${slug}/index.html — fill in the lede.`,
);
console.log(
  `  5. Add a row to docs/data/recipe-facets.json keyed by "${slug}" (language / symptom / severity / tags).`,
);
console.log(
  `  6. (If "${project}" is a new project) add a row to docs/data/projects.json keyed by "${project}".`,
);
console.log(
  '  7. Regenerate indices: cd docs && mise exec -- bun run generate-index && mise exec -- bun run generate-project-pages',
);
console.log(
  `  8. Local verify: cd src/layer2_docker/${slug} && docker build -t vivarium-${slug}:dev . && docker run --rm vivarium-${slug}:dev`,
);
console.log(
  '  9. Lint + docs build: mise run docs:check && mise run markdown:check && (cd docs && mise exec -- bun run build).',
);
console.log(`  10. Commit: feat(layer2): ${slug} reproduction (...)`);
