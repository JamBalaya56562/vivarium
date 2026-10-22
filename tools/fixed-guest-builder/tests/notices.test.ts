import { describe, expect, test } from 'bun:test';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BuildError } from '../src/errors.ts';
import {
  collectSourceLicenses,
  parseAboutListing,
  renderNotices,
} from '../src/notices.ts';
import { tempDir } from './helpers/git.ts';

const SOURCE = {
  tool: 'biome',
  repository: 'https://github.com/biomejs/biome',
  commit: 'a'.repeat(40),
};
const encoder = new TextEncoder();

function about(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

const listing = {
  overview: [],
  licenses: [
    {
      name: 'MIT License',
      id: 'MIT',
      text: 'MIT License\r\n\r\nCopyright (c) Someone\r\n',
      used_by: [
        { crate: { name: 'serde', version: '1.0.0' } },
        { crate: { name: 'biome_js_formatter', version: '0.0.0' } },
      ],
    },
    {
      name: 'Apache License 2.0',
      id: 'Apache-2.0',
      text: 'Apache text with ``` inside',
      used_by: [{ crate: { name: 'ring', version: '0.17.13' } }],
    },
  ],
  crates: [
    {
      package: {
        name: 'serde',
        version: '1.0.0',
        source: 'registry+https://github.com/rust-lang/crates.io-index',
        manifest_path: '/cargo/registry/src/serde-1.0.0/Cargo.toml',
      },
    },
    {
      package: {
        name: 'biome_cli',
        version: '0.0.0',
        source: null,
        manifest_path: '/work/crates/biome_cli/Cargo.toml',
      },
    },
    {
      package: {
        name: 'biome_js_formatter',
        version: '0.0.0',
        source: null,
        manifest_path: '/work/crates/biome_js_formatter/Cargo.toml',
      },
    },
  ],
};

function code(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof BuildError) return error.code;
    throw error;
  }
  return undefined;
}

async function asyncCode(
  promise: Promise<unknown>,
): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BuildError) return error.code;
    throw error;
  }
  return undefined;
}

describe('parseAboutListing', () => {
  test('accepts the repeated target keys cargo-about copies from cargo metadata', () => {
    const text = JSON.stringify(listing).replace(
      '"source":null,',
      '"source":null,"targets":[{"doctest":true,"doctest":false}],',
    );
    expect(parseAboutListing(encoder.encode(text)).licenses).toHaveLength(2);
  });

  test('refuses a listing over the size limit or that is not JSON', () => {
    expect(code(() => parseAboutListing(new Uint8Array(67_108_865)))).toBe(
      'LIMIT_EXCEEDED',
    );
    expect(code(() => parseAboutListing(encoder.encode('{')))).toBe(
      'INVALID_INPUT',
    );
  });

  test('keeps each license with its crates and the workspace crate directories', () => {
    const parsed = parseAboutListing(about(listing));
    expect(parsed.licenses.map((license) => license.id)).toEqual([
      'MIT',
      'Apache-2.0',
    ]);
    expect(parsed.licenses[0]?.usedBy).toEqual([
      { name: 'serde', version: '1.0.0' },
      { name: 'biome_js_formatter', version: '0.0.0' },
    ]);
    expect(parsed.workspaceDirectories).toEqual([
      'crates/biome_cli',
      'crates/biome_js_formatter',
    ]);
  });

  test('refuses a listing with no licenses, an unused license or malformed fields', () => {
    expect(
      code(() => parseAboutListing(about({ ...listing, licenses: [] }))),
    ).toBe('VERIFY_FAILED');
    expect(
      code(() =>
        parseAboutListing(
          about({
            ...listing,
            licenses: [{ ...listing.licenses[0], used_by: [] }],
          }),
        ),
      ),
    ).toBe('INVALID_INPUT');
    expect(
      code(() =>
        parseAboutListing(
          about({
            ...listing,
            licenses: [{ ...listing.licenses[0], text: '' }],
          }),
        ),
      ),
    ).toBe('INVALID_INPUT');
    expect(code(() => parseAboutListing(about([])))).toBe('INVALID_INPUT');
    expect(
      code(() => parseAboutListing(about({ ...listing, crates: {} }))),
    ).toBe('INVALID_INPUT');
    expect(
      code(() =>
        parseAboutListing(
          about({
            ...listing,
            licenses: [{ ...listing.licenses[0], used_by: [1] }],
          }),
        ),
      ),
    ).toBe('INVALID_INPUT');
  });

  test('refuses a workspace crate outside the source', () => {
    for (const manifest_path of [
      '/elsewhere/x/Cargo.toml',
      'crates/x/Cargo.toml',
    ])
      expect(
        code(() =>
          parseAboutListing(
            about({
              ...listing,
              crates: [
                {
                  package: {
                    name: 'x',
                    version: '0.0.0',
                    source: null,
                    manifest_path,
                  },
                },
              ],
            }),
          ),
        ),
      ).toBe('VERIFY_FAILED');
  });
});

describe('renderNotices', () => {
  test('lists every license with its crates and fences texts that hold backticks', () => {
    const text = new TextDecoder().decode(
      renderNotices(parseAboutListing(about(listing)), SOURCE),
    );
    expect(text).toStartWith('# Third-party notices\n');
    expect(text).toContain(SOURCE.commit);
    expect(text).toContain('## MIT License (MIT)');
    expect(text).toContain('- serde 1.0.0\n- biome_js_formatter 0.0.0');
    expect(text).toContain('Copyright (c) Someone\n```');
    expect(text).not.toContain('\r');
    expect(text).toContain('````text\nApache text with ``` inside\n````');
  });

  test('is the same for the same listing', () => {
    const parsed = parseAboutListing(about(listing));
    expect(renderNotices(parsed, SOURCE)).toEqual(
      renderNotices(parsed, SOURCE),
    );
  });

  test('refuses notices above the size limit', () => {
    const big = {
      ...listing,
      licenses: [{ ...listing.licenses[0], text: 'x'.repeat(4_194_304) }],
    };
    expect(
      code(() => renderNotices(parseAboutListing(about(big)), SOURCE)),
    ).toBe('LIMIT_EXCEEDED');
  });
});

describe('collectSourceLicenses', () => {
  async function source(): Promise<string> {
    const root = await tempDir('fgb-licenses-');
    await writeFile(join(root, 'LICENSE-MIT'), 'MIT License\r\nBiome\r\n');
    await writeFile(join(root, 'LICENSE-APACHE'), 'Apache License\n');
    await writeFile(join(root, 'README.md'), 'not a license\n');
    await mkdir(join(root, 'crates', 'biome_js_formatter'), {
      recursive: true,
    });
    await writeFile(
      join(root, 'crates', 'biome_js_formatter', 'PRETTIER_LICENSE'),
      'Prettier MIT\n',
    );
    await writeFile(
      join(root, 'crates', 'biome_js_formatter', 'Cargo.toml'),
      '[package]\n',
    );
    await mkdir(join(root, 'crates', 'biome_cli'), { recursive: true });
    await mkdir(join(root, 'crates', 'unused'), { recursive: true });
    await writeFile(join(root, 'crates', 'unused', 'LICENSE'), 'unused\n');
    return root;
  }

  test('takes the root license files, then those of the workspace crates in the build', async () => {
    const root = await source();
    await symlink('/etc/hosts', join(root, 'NOTICE'));
    const text = new TextDecoder().decode(
      await collectSourceLicenses(
        root,
        parseAboutListing(about(listing)),
        SOURCE,
      ),
    );
    const order = [
      'LICENSE-APACHE',
      'LICENSE-MIT',
      'crates/biome_js_formatter/PRETTIER_LICENSE',
    ];
    const positions = order.map((path) => text.indexOf(`\n${path}\n`));
    expect(positions.every((at) => at > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toContain('MIT License\nBiome\n');
    expect(text).toContain('Prettier MIT');
    expect(text).not.toContain('not a license');
    expect(text).not.toContain('unused');
    expect(text).not.toContain('\nNOTICE\n');
    expect(text).toContain(SOURCE.commit);
  });

  test('refuses a source with no license file at its root or a missing crate directory', async () => {
    const empty = await tempDir('fgb-licenses-');
    expect(
      await asyncCode(
        collectSourceLicenses(empty, parseAboutListing(about(listing)), SOURCE),
      ),
    ).toBe('VERIFY_FAILED');
    const root = await source();
    const missing = parseAboutListing(about(listing));
    missing.workspaceDirectories.push('crates/absent');
    expect(await asyncCode(collectSourceLicenses(root, missing, SOURCE))).toBe(
      'VERIFY_FAILED',
    );
  });

  test('refuses license files above the size limit', async () => {
    const root = await source();
    await writeFile(join(root, 'COPYING'), 'x'.repeat(4_194_304));
    expect(
      await asyncCode(
        collectSourceLicenses(root, parseAboutListing(about(listing)), SOURCE),
      ),
    ).toBe('LIMIT_EXCEEDED');
  });
});
