import { type EditorAction, LineEditor } from './formicarium_line_editor.js';
import {
  DEFAULT_STRINGS,
  type ExitDetail,
  type ReadyDetail,
  TERMINAL_ELEMENT,
  TerminalController,
  type TerminalOptions,
  type TerminalView,
} from './formicarium_terminal.js';
import { loadXterm, type XtermTerminal } from './xterm_loader.js';

export type TerminalElementOptions = Omit<TerminalOptions, 'view'>;

export interface FormicariumTerminalElement extends HTMLElement {
  readonly ready: Promise<ReadyDetail>;
  readonly transcript: string;
  run(command: string): Promise<ExitDetail>;
  enableInput(): void;
}

const PROMPT = '$ ';
const ERASE_LINE = '\r\x1b[2K';
const FONT = "'JetBrains Mono', ui-monospace, monospace";

class FormicariumTerminal extends HTMLElement {
  #controller: TerminalController | null = null;
  #loading = document.createElement('div');
  #fill = document.createElement('div');
  #status = document.createElement('span');
  #progress = document.createElement('span');
  #notice = document.createElement('p');
  #screen = document.createElement('div');
  #term: XtermTerminal | null = null;
  #plain = false;
  #plainOutput = document.createElement('pre');
  #plainInput = document.createElement('input');
  #resize: ResizeObserver | null = null;
  #editor = new LineEditor();
  #latest = '';
  #shown = '';
  #echoed = '';
  #inputEnabled = false;
  #prompting = false;

  configure(options: TerminalElementOptions): void {
    const strings = options.strings ?? DEFAULT_STRINGS;
    const bar = document.createElement('div');
    const row = document.createElement('div');
    this.#loading.className = 'vh-progress vh-terminal__loading';
    bar.className = 'vh-progress__bar';
    this.#fill.className = 'vh-progress__fill';
    row.className = 'vh-progress__row';
    this.#status.className = 'vh-progress__label';
    this.#status.setAttribute('role', 'status');
    this.#status.setAttribute('aria-live', 'polite');
    this.#progress.className = 'vh-progress__bytes';
    bar.append(this.#fill);
    row.append(this.#status, this.#progress);
    this.#loading.append(bar, row);
    this.#notice.className = 'vh-terminal__notice';
    this.#screen.className = 'vh-terminal__screen';
    this.#screen.setAttribute('aria-label', strings.input);
    this.#plainOutput.className = 'vh-terminal__plain';
    this.#plainInput.className = 'vh-terminal__plain-input';
    this.#plainInput.type = 'text';
    this.#plainInput.autocomplete = 'off';
    this.#plainInput.spellcheck = false;
    this.#plainInput.disabled = true;
    this.#plainInput.setAttribute('aria-label', strings.input);
    const view: TerminalView = {
      setState: (state, text) => {
        this.dataset['state'] = state;
        this.#status.textContent = text;
        if (state === 'ready' || state === 'running') {
          this.#fill.style.width = '100%';
          this.#loading.classList.add('is-done');
        }
      },
      setTranscript: (text, notice) => {
        this.#notice.textContent = notice;
        this.#latest = text;
        this.#render();
      },
      setProgress: (fraction, text) => {
        if (fraction !== null)
          this.#fill.style.width = `${Math.min(100, Math.max(5, fraction * 100))}%`;
        this.#progress.textContent = text;
      },
      setInputEnabled: (enabled) => {
        this.#inputEnabled = enabled;
        this.#plainInput.disabled = !enabled;
        if (enabled) this.#echoed = '';
        this.#syncPrompt();
      },
    };
    this.#controller = new TerminalController({ ...options, view });
  }

  get ready(): Promise<ReadyDetail> {
    return (this.#controller as TerminalController).ready;
  }

  get transcript(): string {
    return this.#controller?.transcript ?? '';
  }

  run(command: string): Promise<ExitDetail> {
    return (this.#controller as TerminalController).run(command);
  }

  enableInput(): void {
    this.#controller?.enableInput();
  }

  connectedCallback(): void {
    if (this.#controller === null) return;
    this.replaceChildren(this.#loading, this.#screen, this.#notice);
    void this.#mountXterm();
    if (this.#controller.state === 'connecting')
      this.#controller.boot().catch(() => undefined);
  }

  disconnectedCallback(): void {
    this.#resize?.disconnect();
    this.#resize = null;
    this.#term?.dispose();
    this.#term = null;
    void this.#controller?.dispose();
  }

  async #mountXterm(): Promise<void> {
    let term: XtermTerminal | null = null;
    try {
      const { Terminal, FitAddon } = await loadXterm();
      await document.fonts.load(`13px ${FONT}`).catch(() => undefined);
      if (!this.isConnected || this.#term !== null) return;
      term = new Terminal({
        convertEol: true,
        cursorBlink: true,
        screenReaderMode: true,
        scrollback: 10000,
        fontFamily: FONT,
        fontSize: 13,
        theme: {
          background: '#0a1f1a',
          foreground: '#e0e6e3',
          cursor: '#00d4aa',
          selectionBackground: 'rgba(0, 212, 170, 0.3)',
        },
        linkHandler: { activate: () => undefined },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(this.#screen);
      term.attachCustomKeyEventHandler((event) => event.key !== 'Tab');
      term.onData((data) => this.#onData(data));
      this.#resize = new ResizeObserver(() => {
        if (this.#screen.clientWidth && this.#screen.clientHeight) fit.fit();
      });
      this.#resize.observe(this.#screen);
      this.#term = term;
    } catch {
      this.#resize?.disconnect();
      this.#resize = null;
      term?.dispose();
      this.#mountPlain();
    }
    this.#shown = '';
    this.#prompting = false;
    this.#render();
  }

  #mountPlain(): void {
    this.#plain = true;
    const form = document.createElement('form');
    form.append(this.#plainInput);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const command = this.#plainInput.value;
      if (command.trim() === '') return;
      this.#plainInput.value = '';
      this.#controller?.run(command).catch(() => undefined);
    });
    this.#screen.replaceChildren(this.#plainOutput, form);
  }

  #render(): void {
    if (this.#plain) {
      this.#plainOutput.textContent = this.#latest;
      this.#screen.scrollTop = this.#screen.scrollHeight;
      return;
    }
    const term = this.#term;
    if (term === null) return;
    let out = this.#prompting ? ERASE_LINE : '';
    if (this.#shown !== '' && this.#latest.startsWith(this.#shown)) {
      let added = this.#latest.slice(this.#shown.length);
      if (this.#echoed !== '' && added.startsWith(this.#echoed))
        added = added.slice(this.#echoed.length);
      out += added;
    } else {
      term.reset();
      out = this.#latest;
    }
    this.#echoed = '';
    this.#shown = this.#latest;
    this.#prompting = this.#inputEnabled;
    if (this.#prompting) out += PROMPT + this.#editor.line;
    term.write(out);
  }

  #syncPrompt(): void {
    const term = this.#term;
    if (term === null || this.#inputEnabled === this.#prompting) return;
    this.#prompting = this.#inputEnabled;
    term.write(this.#prompting ? PROMPT + this.#editor.line : ERASE_LINE);
    if (this.#prompting) term.focus();
  }

  #onData(data: string): void {
    if (!this.#inputEnabled || !this.#prompting) return;
    for (const action of this.#editor.handle(data)) this.#apply(action);
  }

  #apply(action: EditorAction): void {
    const term = this.#term as XtermTerminal;
    switch (action.kind) {
      case 'write':
        term.write(action.text);
        return;
      case 'replace':
        term.write(ERASE_LINE + PROMPT + action.line);
        return;
      case 'cancel-line':
        term.write(`^C\n${PROMPT}`);
        return;
      case 'submit':
        if (action.line.trim() === '') {
          term.write(`\n${PROMPT}`);
          return;
        }
        term.write('\n');
        this.#prompting = false;
        this.#echoed = `${PROMPT}${action.line}\n`;
        this.#controller?.run(action.line).catch(() => undefined);
    }
  }
}

export function createFormicariumTerminal(
  options: TerminalElementOptions,
): FormicariumTerminalElement {
  if (customElements.get(TERMINAL_ELEMENT) === undefined)
    customElements.define(TERMINAL_ELEMENT, FormicariumTerminal);
  const element = document.createElement(
    TERMINAL_ELEMENT,
  ) as FormicariumTerminal;
  element.configure(options);
  return element;
}
