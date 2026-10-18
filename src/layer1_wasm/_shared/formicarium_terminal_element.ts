import {
  DEFAULT_STRINGS,
  type ExitDetail,
  type ReadyDetail,
  TERMINAL_ELEMENT,
  TerminalController,
  type TerminalOptions,
  type TerminalView,
} from './formicarium_terminal.js';

export type TerminalElementOptions = Omit<TerminalOptions, 'view'>;

export interface FormicariumTerminalElement extends HTMLElement {
  readonly ready: Promise<ReadyDetail>;
  readonly transcript: string;
  run(command: string): Promise<ExitDetail>;
  enableInput(): void;
}

class FormicariumTerminal extends HTMLElement {
  #controller: TerminalController | null = null;
  #status = document.createElement('p');
  #progress = document.createElement('p');
  #notice = document.createElement('p');
  #output = document.createElement('pre');
  #form = document.createElement('form');
  #input = document.createElement('input');

  configure(options: TerminalElementOptions): void {
    const strings = options.strings ?? DEFAULT_STRINGS;
    this.#status.className = 'vh-terminal__status';
    this.#status.setAttribute('role', 'status');
    this.#status.setAttribute('aria-live', 'polite');
    this.#progress.className = 'vh-terminal__progress';
    this.#notice.className = 'vh-terminal__notice';
    this.#output.className = 'vh-terminal__output';
    this.#output.tabIndex = 0;
    this.#input.type = 'text';
    this.#input.className = 'vh-terminal__input';
    this.#input.autocomplete = 'off';
    this.#input.spellcheck = false;
    this.#input.setAttribute('aria-label', strings.input);
    this.#form.append(this.#input);
    this.#form.addEventListener('submit', (event) => {
      event.preventDefault();
      const command = this.#input.value;
      if (command.trim() === '' || this.#controller === null) return;
      this.#input.value = '';
      this.#controller.run(command).catch(() => undefined);
    });
    const view: TerminalView = {
      setState: (state, text) => {
        this.dataset['state'] = state;
        this.#status.textContent = text;
      },
      setTranscript: (text, notice) => {
        this.#output.textContent = text;
        this.#notice.textContent = notice;
        this.#output.scrollTop = this.#output.scrollHeight;
      },
      setProgress: (text) => {
        this.#progress.textContent = text;
      },
      setInputEnabled: (enabled) => {
        this.#input.disabled = !enabled;
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
    this.replaceChildren(
      this.#status,
      this.#progress,
      this.#output,
      this.#notice,
      this.#form,
    );
    if (this.#controller.state === 'connecting')
      this.#controller.boot().catch(() => undefined);
  }

  disconnectedCallback(): void {
    void this.#controller?.dispose();
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
