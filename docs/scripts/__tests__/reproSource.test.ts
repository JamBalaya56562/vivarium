import { describe, expect, test } from 'bun:test';
import {
  extractReproSource,
  extractTemplateLiteral,
} from '../../../src/layer1_wasm/scripts/repro-source';

function reproTs(body: string, declaration = 'const REPRO_CODE = `'): string {
  return `${declaration}\n${body}\n\`.trim();\n`;
}

describe('extractTemplateLiteral', () => {
  test('reads a plain template literal', () => {
    const src = reproTs('print("one")\nprint("two")');
    expect(extractTemplateLiteral(src, 'REPRO_CODE')).toBe(
      'print("one")\nprint("two")',
    );
  });

  test('does not stop at an escaped backtick', () => {
    const src = reproTs('print("one")\nprint("a \\` tick")\nprint("three")');
    expect(extractTemplateLiteral(src, 'REPRO_CODE')).toBe(
      'print("one")\nprint("a ` tick")\nprint("three")',
    );
  });

  test('does not stop at a backtick that follows an escaped backslash', () => {
    const src = reproTs('print("a \\\\ slash")\nprint("still here")');
    expect(extractTemplateLiteral(src, 'REPRO_CODE')).toBe(
      'print("a \\ slash")\nprint("still here")',
    );
  });

  test('unescapes \\n in a plain literal', () => {
    const src = reproTs('print("a\\nb")');
    expect(extractTemplateLiteral(src, 'REPRO_CODE')).toBe('print("a\nb")');
  });

  test('leaves escapes alone in a String.raw literal', () => {
    const src = reproTs(
      "prefix = '\\p{In_Arabic}'",
      'const REPRO_CODE = String.raw`',
    );
    expect(extractTemplateLiteral(src, 'REPRO_CODE')).toBe(
      "prefix = '\\p{In_Arabic}'",
    );
  });

  test('returns null when the name is absent', () => {
    expect(extractTemplateLiteral(reproTs('x'), 'MISSING')).toBeNull();
  });
});

describe('extractReproSource', () => {
  test('prefers REPRO_CODE over REPRO_SOURCE_HINT', () => {
    const src = `${reproTs('the code')}\n${reproTs('the hint', 'const REPRO_SOURCE_HINT = `')}`;
    expect(extractReproSource(src)).toBe('the code');
  });

  test('falls back to REPRO_SOURCE_HINT', () => {
    const src = reproTs('the hint', 'const REPRO_SOURCE_HINT = `');
    expect(extractReproSource(src)).toBe('the hint');
  });
});
