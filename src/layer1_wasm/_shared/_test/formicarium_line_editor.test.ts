import { describe, expect, test } from 'bun:test';
import {
  columns,
  escapeEnd,
  LineEditor,
  MAX_LINE_BYTES,
} from '../formicarium_line_editor.ts';

describe('LineEditor', () => {
  test('echoes typed characters and submits the line on Enter', () => {
    const editor = new LineEditor();
    expect(editor.handle('ls')).toEqual([
      { kind: 'write', text: 'l' },
      { kind: 'write', text: 's' },
    ]);
    expect(editor.handle('\r')).toEqual([{ kind: 'submit', line: 'ls' }]);
    expect(editor.line).toBe('');
  });

  test('erases one character, two columns for a wide one', () => {
    const editor = new LineEditor();
    editor.handle('aあ');
    expect(editor.handle('\x7f')).toEqual([
      { kind: 'write', text: '\b\b  \b\b' },
    ]);
    expect(editor.handle('\x7f')).toEqual([{ kind: 'write', text: '\b \b' }]);
    expect(editor.handle('\x7f')).toEqual([]);
  });

  test('Ctrl-C drops the line', () => {
    const editor = new LineEditor();
    editor.handle('cat');
    expect(editor.handle('\x03')).toEqual([{ kind: 'cancel-line' }]);
    expect(editor.line).toBe('');
  });

  test('arrow keys walk the history, skipping blanks and repeats', () => {
    const editor = new LineEditor();
    for (const key of [...'a\ra\r \rb\r']) editor.handle(key);
    expect(editor.history).toEqual(['a', 'b']);
    expect(editor.handle('\x1b[A')).toEqual([{ kind: 'replace', line: 'b' }]);
    expect(editor.handle('\x1bOA')).toEqual([{ kind: 'replace', line: 'a' }]);
    expect(editor.handle('\x1b[A')).toEqual([{ kind: 'replace', line: 'a' }]);
    expect(editor.handle('\x1b[B')).toEqual([{ kind: 'replace', line: 'b' }]);
    expect(editor.handle('\x1b[B')).toEqual([{ kind: 'replace', line: '' }]);
  });

  test('a pasted block keeps its first line and is not run', () => {
    const editor = new LineEditor();
    const actions = editor.handle('echo hi\nrm -rf x\n');
    expect(actions.every((action) => action.kind === 'write')).toBe(true);
    expect(editor.line).toBe('echo hi');
  });

  test('ignores other escape sequences and control characters', () => {
    const editor = new LineEditor();
    expect(editor.handle('\x1b[C\x1b]0;t\x07\x01x')).toEqual([
      { kind: 'write', text: 'x' },
    ]);
  });

  test('stops at the line limit', () => {
    const editor = new LineEditor();
    editor.line = 'a'.repeat(MAX_LINE_BYTES);
    expect(editor.handle('b')).toEqual([]);
  });
});

test('escapeEnd and columns', () => {
  expect(escapeEnd('\x1b[1;5A', 0)).toBe(6);
  expect(escapeEnd('\x1bOA', 0)).toBe(3);
  expect(escapeEnd('\x1b]0;x\x1b\\', 0)).toBe(7);
  expect(escapeEnd('\x1b', 0)).toBe(1);
  expect(columns('a')).toBe(1);
  expect(columns('漢')).toBe(2);
});
