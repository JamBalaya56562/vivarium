import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import npm from '../package.json';
import jsr from '../jsr.json';
import { isPublished, validateVersion } from '../scripts/release';
import { createServer } from '../src/server';

const metadata = { name: '@aletheia-works/vivarium-mcp', version: '0.2.2' };

describe('release validation', () => {
  test('accepts matching metadata and tag', () => {
    expect(validateVersion(metadata, metadata, 'v0.2.2')).toBe(
      '0.2.2',
    );
  });
  test('rejects mismatched names, versions and tags', () => {
    expect(() =>
      validateVersion(metadata, { ...metadata, version: '0.2.1' }),
    ).toThrow();
    expect(() =>
      validateVersion(metadata, { ...metadata, name: 'other' }),
    ).toThrow();
    for (const tag of ['', 'mcp-server-v0.2.2', 'v0.2.1']) {
      expect(() => validateVersion(metadata, metadata, tag)).toThrow();
    }
  });
  test('rejects invalid versions', () => {
    for (const version of [
      'latest',
      '01.2.3',
      '1.2',
      '1.2.3/other',
      '1.2.3-01',
    ]) {
      expect(() =>
        validateVersion({ ...metadata, version }, { ...metadata, version }),
      ).toThrow();
    }
  });
  test('reports the packaged version in the MCP handshake', async () => {
    validateVersion(npm, jsr);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createServer();
    const client = new Client({ name: 'release-test', version: '1.0.0' });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      expect(client.getServerVersion()?.version).toBe(npm.version);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe('registry checks', () => {
  const probe = (status: number, body = '{"version":"0.2.2"}') =>
    isPublished(
      'https://registry.example/package',
      (async () => new Response(body, { status })) as typeof fetch,
    );
  test('only 404 means unpublished', async () => {
    expect(await probe(404, 'Not found')).toBe(false);
    expect(await probe(200)).toBe(true);
    expect(await probe(200, '{"manifest":{}}')).toBe(true);
    for (const status of [401, 403, 429, 500, 503]) {
      await expect(probe(status)).rejects.toThrow();
    }
  });
  test('fails on malformed metadata and network errors', async () => {
    for (const body of ['not json', 'null', '[]', '{}']) {
      await expect(probe(200, body)).rejects.toThrow();
    }
    await expect(
      isPublished('https://registry.example/package', (async () => {
        throw new Error('Network unavailable');
      }) as typeof fetch),
    ).rejects.toThrow('Network unavailable');
  });
});
