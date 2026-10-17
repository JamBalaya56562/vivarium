import { fail } from './errors.ts';

export interface FixedGuestDeclaration {
  tool: string;
  repository: string;
  commit: string;
  fixture: string;
  reference?: { pr?: string; branch?: string };
}

export interface Allowlist {
  schemaVersion: 1;
  repositories: readonly string[];
  // Kept apart so a dependency source can never be declared as a guest.
  dependencyRepositories: readonly string[];
}

const COMMIT = /^[0-9a-f]{40}$/;
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SEGMENT = /^[a-z0-9][a-z0-9._-]{0,99}$/;

export function normalizeRepositoryUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096)
    fail('INVALID_INPUT', 'repository must be a non-empty string');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail('INVALID_INPUT', 'repository is not an absolute URL');
  }
  if (url.protocol !== 'https:')
    fail('INVALID_INPUT', 'repository must use https');
  if (url.username || url.password)
    fail('INVALID_INPUT', 'repository must not carry credentials');
  // The URL parser drops a default port such as `:443`, so the original
  // authority is checked too.
  const authority = value.slice('https://'.length).split('/')[0]?.toLowerCase();
  if (
    url.hostname !== 'github.com' ||
    url.port !== '' ||
    authority !== 'github.com'
  )
    fail('INVALID_INPUT', 'repository must be on github.com without a port');
  if (url.search || url.hash || value.includes('?') || value.includes('#'))
    fail('INVALID_INPUT', 'repository must not carry a query or fragment');
  let path = url.pathname.toLowerCase();
  if (path.endsWith('/')) path = path.slice(0, -1);
  if (path.endsWith('.git')) path = path.slice(0, -4);
  const parts = path.split('/').slice(1);
  if (parts.length !== 2 || !parts.every((part) => SEGMENT.test(part)))
    fail(
      'INVALID_INPUT',
      'repository must be https://github.com/<owner>/<repo>',
    );
  return `https://github.com/${parts[0]}/${parts[1]}`;
}

export function parseAllowlist(value: unknown): Allowlist {
  if (typeof value !== 'object' || value === null)
    fail('INVALID_INPUT', 'allowlist must be an object');
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1)
    fail('INVALID_INPUT', 'allowlist schemaVersion must be 1');
  if (!Array.isArray(record.repositories) || record.repositories.length === 0)
    fail('INVALID_INPUT', 'allowlist repositories must be a non-empty array');
  const dependencies = record.dependencyRepositories ?? [];
  if (!Array.isArray(dependencies))
    fail('INVALID_INPUT', 'allowlist dependencyRepositories must be an array');
  const normalizedList = (entries: unknown[]) => {
    const list = entries.map((entry) => {
      const normalized = normalizeRepositoryUrl(entry);
      if (normalized !== entry)
        fail(
          'INVALID_INPUT',
          `allowlist entry is not normalized: ${String(entry)}`,
        );
      return normalized;
    });
    if (new Set(list).size !== list.length)
      fail('INVALID_INPUT', 'allowlist entries must be unique');
    return list;
  };
  return {
    schemaVersion: 1,
    repositories: normalizedList(record.repositories),
    dependencyRepositories: normalizedList(dependencies),
  };
}

export function validateDeclaration(
  value: unknown,
  allowlist: Allowlist,
): FixedGuestDeclaration {
  if (typeof value !== 'object' || value === null)
    fail('INVALID_INPUT', 'declaration must be an object');
  const record = value as Record<string, unknown>;
  const { tool, commit, fixture, reference } = record;
  if (typeof tool !== 'string' || !NAME.test(tool))
    fail('INVALID_INPUT', 'tool must be a lowercase name');
  if (typeof commit !== 'string')
    fail('INVALID_INPUT', 'commit is required; a branch alone is not accepted');
  if (!COMMIT.test(commit))
    fail('INVALID_INPUT', 'commit must be 40 lowercase hexadecimal characters');
  if (
    typeof fixture !== 'string' ||
    fixture.length === 0 ||
    fixture.length > 256
  )
    fail('INVALID_INPUT', 'fixture must be a non-empty identifier');
  const repository = normalizeRepositoryUrl(record.repository);
  if (!allowlist.repositories.includes(repository))
    fail('INVALID_INPUT', `repository is not in the allowlist: ${repository}`);
  const result: FixedGuestDeclaration = { tool, repository, commit, fixture };
  if (reference !== undefined) {
    if (typeof reference !== 'object' || reference === null)
      fail('INVALID_INPUT', 'reference must be an object when present');
    const { pr, branch } = reference as Record<string, unknown>;
    const kept: { pr?: string; branch?: string } = {};
    if (pr !== undefined) {
      if (typeof pr !== 'string')
        fail('INVALID_INPUT', 'reference.pr must be a string');
      kept.pr = pr;
    }
    if (branch !== undefined) {
      if (typeof branch !== 'string')
        fail('INVALID_INPUT', 'reference.branch must be a string');
      kept.branch = branch;
    }
    result.reference = kept;
  }
  return result;
}
