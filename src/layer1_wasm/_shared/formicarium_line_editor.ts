export const MAX_LINE_BYTES = 65536;

export type EditorAction =
  | { kind: 'write'; text: string }
  | { kind: 'submit'; line: string }
  | { kind: 'cancel-line' }
  | { kind: 'replace'; line: string };

const HISTORY_UP = new Set(['\x1b[A', '\x1bOA']);
const HISTORY_DOWN = new Set(['\x1b[B', '\x1bOB']);

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function columns(character: string): number {
  const code = character.codePointAt(0) ?? 0;
  return (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
    ? 2
    : 1;
}

export function escapeEnd(text: string, start: number): number {
  const kind = text[start + 1];
  if (kind === undefined) return text.length;
  if (kind === '[') {
    for (let index = start + 2; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) return index + 1;
      if (code < 0x20 || code > 0x3f) return index;
    }
    return text.length;
  }
  if (kind === ']' || kind === 'P' || kind === '_' || kind === '^') {
    for (let index = start + 2; index < text.length; index++) {
      if (text[index] === '\x07') return index + 1;
      if (text[index] === '\x1b' && text[index + 1] === '\\') return index + 2;
    }
    return text.length;
  }
  if (kind === 'O') return Math.min(start + 3, text.length);
  return start + 2;
}

export class LineEditor {
  line = '';
  readonly history: string[] = [];
  #index = 0;

  handle(data: string): EditorAction[] {
    const actions: EditorAction[] = [];
    const newline = data.search(/[\r\n]/);
    const input = data.length > 1 && newline !== -1 ? data.slice(0, newline) : data;
    for (let index = 0; index < input.length; ) {
      const character = String.fromCodePoint(input.codePointAt(index) ?? 0);
      if (character === '\x1b') {
        const end = escapeEnd(input, index);
        const sequence = input.slice(index, end);
        index = end;
        if (HISTORY_UP.has(sequence)) actions.push(this.#move(-1));
        else if (HISTORY_DOWN.has(sequence)) actions.push(this.#move(1));
        continue;
      }
      index += character.length;
      if (character === '\r' || character === '\n') {
        actions.push(this.#submit());
        continue;
      }
      if (character === '\x03') {
        this.reset();
        actions.push({ kind: 'cancel-line' });
        continue;
      }
      if (character === '\x7f' || character === '\b') {
        actions.push(...this.#erase());
        continue;
      }
      if (character.charCodeAt(0) < 0x20) continue;
      if (utf8Length(this.line) + utf8Length(character) > MAX_LINE_BYTES)
        break;
      this.line += character;
      actions.push({ kind: 'write', text: character });
    }
    return actions;
  }

  reset(): void {
    this.line = '';
    this.#index = this.history.length;
  }

  #submit(): EditorAction {
    const line = this.line;
    if (line.trim() !== '' && this.history.at(-1) !== line)
      this.history.push(line);
    this.reset();
    return { kind: 'submit', line };
  }

  #erase(): EditorAction[] {
    const characters = [...this.line];
    const last = characters.pop();
    if (last === undefined) return [];
    this.line = characters.join('');
    const width = columns(last);
    return [
      {
        kind: 'write',
        text: '\b'.repeat(width) + ' '.repeat(width) + '\b'.repeat(width),
      },
    ];
  }

  #move(step: number): EditorAction {
    this.#index = Math.min(
      this.history.length,
      Math.max(0, this.#index + step),
    );
    this.line = this.history[this.#index] ?? '';
    return { kind: 'replace', line: this.line };
  }
}
