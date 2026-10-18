import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import v8toIstanbul from 'v8-to-istanbul';
import { resolveReproFile } from '../../../docs/scripts/repro-dev-middleware';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const DENOMINATOR = resolve(import.meta.dirname, '..', 'u6-coverage.json');
const RECIPE = 'biome-migrate-override-bracket-spacing';
const STAGED = resolve(
  import.meta.dirname,
  '..',
  RECIPE,
  '_formicarium',
  'assets.json',
);
const REPRO_URL = /^\/vivarium(?:\/ja)?\/repro\/(.+)$/;

interface Denominator {
  minLineCoverage: number;
  files: string[];
}

export interface V8Entry {
  url: string;
  source?: string;
  functions: {
    functionName: string;
    isBlockCoverage: boolean;
    ranges: { startOffset: number; endOffset: number; count: number }[];
  }[];
}

export type LineHits = Map<string, Map<number, number>>;

export function parseLcov(text: string, root = REPO_ROOT): LineHits {
  const files: LineHits = new Map();
  let current: Map<number, number> | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) {
      const path = relative(root, resolve(root, line.slice(3)));
      current = files.get(path) ?? new Map();
      files.set(path, current);
    } else if (line.startsWith('DA:') && current) {
      const [lineNo, count] = line.slice(3).split(',').map(Number);
      if (Number.isSafeInteger(lineNo) && Number.isSafeInteger(count))
        current.set(
          lineNo as number,
          Math.max(current.get(lineNo as number) ?? 0, count as number),
        );
    } else if (line === 'end_of_record') current = null;
  }
  return files;
}

export function localScript(url: string): string | null {
  const match = REPRO_URL.exec(new URL(url).pathname);
  if (!match) return null;
  return resolveReproFile(match[1] as string);
}

export async function browserLineHits(
  entries: readonly V8Entry[],
  root = REPO_ROOT,
): Promise<LineHits> {
  const files: LineHits = new Map();
  for (const entry of entries) {
    const script = localScript(entry.url);
    if (
      script === null ||
      !script.endsWith('.js') ||
      !existsSync(`${script}.map`)
    )
      continue;
    const converter = v8toIstanbul(script, 0, {
      source: entry.source ?? readFileSync(script, 'utf-8'),
    });
    await converter.load();
    converter.applyCoverage(entry.functions);
    for (const coverage of Object.values(converter.toIstanbul())) {
      const path = relative(root, coverage.path);
      const lines = files.get(path) ?? new Map<number, number>();
      for (const [id, location] of Object.entries(coverage.statementMap)) {
        const count = coverage.s[id] ?? 0;
        for (
          let line = location.start.line;
          line <= location.end.line;
          line += 1
        )
          lines.set(line, Math.max(lines.get(line) ?? 0, count));
      }
      files.set(path, lines);
    }
    converter.destroy();
  }
  return files;
}

export interface FileReport {
  path: string;
  lines: number;
  hit: number;
  sources: string[];
}

export interface CoverageReport {
  status: 'passed' | 'failed' | 'not-measured';
  reason: string;
  minLineCoverage: number;
  lines: number;
  hit: number;
  percent: number;
  files: FileReport[];
  missing: string[];
}

export function mergeCoverage(
  denominator: Denominator,
  bun: LineHits,
  browser: LineHits,
  browserRequired: boolean,
): CoverageReport {
  const files: FileReport[] = [];
  const missing: string[] = [];
  for (const path of denominator.files) {
    const fromBun = bun.get(path);
    const fromBrowser = browser.get(path);
    if (!fromBun && !fromBrowser) {
      missing.push(path);
      continue;
    }
    const base = fromBun ?? fromBrowser ?? new Map<number, number>();
    let hit = 0;
    for (const [line, count] of base)
      if (count > 0 || (fromBrowser?.get(line) ?? 0) > 0) hit += 1;
    files.push({
      path,
      lines: base.size,
      hit,
      sources: [
        ...(fromBun ? ['bun'] : []),
        ...(fromBrowser ? ['chromium'] : []),
      ],
    });
  }
  const lines = files.reduce((sum, file) => sum + file.lines, 0);
  const hit = files.reduce((sum, file) => sum + file.hit, 0);
  const percent = lines === 0 ? 0 : Math.round((hit / lines) * 10_000) / 100;
  // Exits 0 so a pending recipe can merge, but it is never a pass: U6
  // acceptance counts only a measured report of an active recipe.
  if (!browserRequired)
    return {
      status: 'not-measured',
      reason: `${RECIPE} is pending and not staged, so its browser files were not run; this is not a pass`,
      minLineCoverage: denominator.minLineCoverage,
      lines,
      hit,
      percent,
      files,
      missing,
    };
  const failures = [
    ...(missing.length > 0 ? [`not measured: ${missing.join(', ')}`] : []),
    ...(percent < denominator.minLineCoverage
      ? [`line coverage ${percent}% is below ${denominator.minLineCoverage}%`]
      : []),
  ];
  return {
    status: failures.length === 0 ? 'passed' : 'failed',
    reason: failures.join('; ') || `line coverage ${percent}%`,
    minLineCoverage: denominator.minLineCoverage,
    lines,
    hit,
    percent,
    files,
    missing,
  };
}

function markdown(report: CoverageReport): string {
  const rows = report.files.map(
    (file) =>
      `| ${file.path} | ${file.hit}/${file.lines} | ${file.lines === 0 ? 0 : Math.round((file.hit / file.lines) * 10_000) / 100}% | ${file.sources.join(', ')} |`,
  );
  return [
    '### U6 line coverage',
    '',
    `Status: **${report.status}** — ${report.reason}. Total ${report.hit}/${report.lines} (${report.percent}%), floor ${report.minLineCoverage}%.`,
    '',
    '| File | Lines hit | % | Measured by |',
    '|---|---:|---:|---|',
    ...rows,
    ...report.missing.map((path) => `| ${path} | 0/? | 0% | not measured |`),
    '',
  ].join('\n');
}

function readV8(dir: string | undefined): V8Entry[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .flatMap(
      (name) => JSON.parse(readFileSync(join(dir, name), 'utf-8')) as V8Entry[],
    );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      lcov: { type: 'string' },
      v8: { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
  });
  if (!values.lcov || !values.out)
    throw new Error(
      'usage: u6-coverage.ts --lcov <lcov.info> [--v8 <dir>] --out <dir>',
    );
  const denominator = JSON.parse(
    readFileSync(DENOMINATOR, 'utf-8'),
  ) as Denominator;
  const report = mergeCoverage(
    denominator,
    parseLcov(readFileSync(values.lcov, 'utf-8')),
    await browserLineHits(readV8(values.v8)),
    existsSync(STAGED),
  );
  mkdirSync(values.out, { recursive: true });
  writeFileSync(
    join(values.out, 'u6-coverage.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  writeFileSync(
    join(values.out, 'u6-coverage-denominator.json'),
    readFileSync(DENOMINATOR),
  );
  const summary = markdown(report);
  writeFileSync(join(values.out, 'u6-coverage.md'), summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  if (report.status === 'failed') process.exit(1);
}

if (import.meta.main) await main();
