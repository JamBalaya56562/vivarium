import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { LICENSE_ASSET, MAX_LICENSE_BYTES, NOTICES_ASSET } from './artifact.ts';
import { MAX_ABOUT_BYTES } from './build.ts';
import { fail } from './errors.ts';

const CONTAINER_SOURCE = '/work';
const LICENSE_FILE = /^(?:.*[._-])?(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i;

export interface AboutLicense {
  name: string;
  id: string;
  text: string;
  usedBy: { name: string; version: string }[];
}

export interface AboutListing {
  licenses: AboutLicense[];
  workspaceDirectories: string[];
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0)
    fail('INVALID_INPUT', `license listing ${label} must be a string`);
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail('INVALID_INPUT', `license listing ${label} must be an object`);
  return value as Record<string, unknown>;
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value))
    fail('INVALID_INPUT', `license listing ${label} must be an array`);
  return value;
}

// Paths in the listing are the container's; a workspace crate must sit
// inside the source so its directory maps back onto the runner.
function workspaceDirectory(manifestPath: unknown): string {
  const path = text(manifestPath, 'manifest_path');
  const directory = posix.dirname(path);
  const relative = posix.relative(CONTAINER_SOURCE, directory);
  if (
    !posix.isAbsolute(path) ||
    relative.startsWith('..') ||
    posix.isAbsolute(relative)
  )
    fail('VERIFY_FAILED', `workspace crate is outside the source: ${path}`);
  return relative;
}

// cargo-about copies cargo metadata, which can repeat keys inside a crate's
// targets, so the listing is parsed leniently rather than with parseUniqueJson.
function readListing(bytes: Uint8Array): unknown {
  if (bytes.byteLength > MAX_ABOUT_BYTES)
    fail(
      'LIMIT_EXCEEDED',
      `license listing is larger than ${MAX_ABOUT_BYTES} bytes`,
    );
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail('INVALID_INPUT', 'license listing is not UTF-8 JSON');
  }
}

export function parseAboutListing(bytes: Uint8Array): AboutListing {
  const root = object(readListing(bytes), 'root');
  const licenses = list(root.licenses, 'licenses').map((raw) => {
    const license = object(raw, 'license');
    const usedBy = list(license.used_by, 'used_by').map((use) => {
      const crate = object(object(use, 'used_by entry').crate, 'crate');
      return {
        name: text(crate.name, 'crate name'),
        version: text(crate.version, 'crate version'),
      };
    });
    if (usedBy.length === 0)
      fail('INVALID_INPUT', 'license listing has a license no crate uses');
    return {
      name: text(license.name, 'license name'),
      id: text(license.id, 'license id'),
      text: text(license.text, 'license text'),
      usedBy,
    };
  });
  if (licenses.length === 0)
    fail('VERIFY_FAILED', 'license listing names no licenses');
  const directories = new Set<string>();
  for (const raw of list(root.crates, 'crates')) {
    const pkg = object(object(raw, 'crate').package, 'package');
    if (pkg.source === null)
      directories.add(workspaceDirectory(pkg.manifest_path));
  }
  return {
    licenses,
    workspaceDirectories: [...directories].sort(),
  };
}

function fence(body: string): string {
  const longest = Math.max(
    2,
    ...[...body.matchAll(/`+/g)].map((match) => match[0].length),
  );
  return '`'.repeat(longest + 1);
}

function checkSize(bytes: Uint8Array, name: string): Uint8Array {
  if (bytes.byteLength > MAX_LICENSE_BYTES)
    fail('LIMIT_EXCEEDED', `${name} is larger than ${MAX_LICENSE_BYTES} bytes`);
  return bytes;
}

export function renderNotices(
  listing: AboutListing,
  source: { tool: string; repository: string; commit: string },
): Uint8Array {
  const lines = [
    '# Third-party notices',
    '',
    `The ${source.tool} binary built from ${source.repository} at ${source.commit} includes the crates below, under the licenses shown.`,
    '',
  ];
  for (const license of listing.licenses) {
    const body = license.text.replace(/\r\n/g, '\n').trimEnd();
    const marks = fence(body);
    lines.push(`## ${license.name} (${license.id})`, '', 'Used by:', '');
    for (const crate of license.usedBy)
      lines.push(`- ${crate.name} ${crate.version}`);
    lines.push('', `${marks}text`, body, marks, '');
  }
  return checkSize(new TextEncoder().encode(lines.join('\n')), NOTICES_ASSET);
}

async function licenseFiles(
  sourceDirectory: string,
  relativeDirectory: string,
): Promise<string[]> {
  const directory = join(sourceDirectory, relativeDirectory);
  const names = await readdir(directory).catch(() =>
    fail('VERIFY_FAILED', `cannot list ${relativeDirectory || 'the source'}`),
  );
  const found: string[] = [];
  for (const name of names.sort()) {
    if (!LICENSE_FILE.test(name)) continue;
    const info = await lstat(join(directory, name));
    if (info.isFile()) found.push(posix.join(relativeDirectory, name));
  }
  return found;
}

export async function collectSourceLicenses(
  sourceDirectory: string,
  listing: AboutListing,
  source: { repository: string; commit: string },
): Promise<Uint8Array> {
  const paths = await licenseFiles(sourceDirectory, '');
  if (paths.length === 0)
    fail('VERIFY_FAILED', 'the source has no license file at its root');
  for (const directory of listing.workspaceDirectories)
    if (directory !== '')
      paths.push(...(await licenseFiles(sourceDirectory, directory)));
  const sections = [
    `License files from ${source.repository} at ${source.commit}.\n`,
  ];
  let total = 0;
  for (const path of paths) {
    const info = await lstat(join(sourceDirectory, path));
    total += info.size;
    if (total > MAX_LICENSE_BYTES)
      fail(
        'LIMIT_EXCEEDED',
        `${LICENSE_ASSET} is larger than ${MAX_LICENSE_BYTES} bytes`,
      );
    const body = (await readFile(join(sourceDirectory, path), 'utf8'))
      .replace(/\r\n/g, '\n')
      .trimEnd();
    sections.push(`${'='.repeat(72)}\n${path}\n${'='.repeat(72)}\n\n${body}\n`);
  }
  return checkSize(
    new TextEncoder().encode(sections.join('\n')),
    LICENSE_ASSET,
  );
}
