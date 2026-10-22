import type { DrawerSide } from '../settings/schema';

const MIN_WIDTH = 320;
const STYLE = `
:host { all: initial; }
.tab {
  position: fixed; bottom: 96px; z-index: 2147483000;
  writing-mode: vertical-rl; padding: 12px 6px;
  font: 600 12px/1 system-ui, sans-serif; letter-spacing: .04em;
  background: #0b6bcb; color: #fff; border: none; cursor: pointer;
  box-shadow: 0 1px 4px rgba(0,0,0,.3);
}
/* Rotated so the label reads bottom-to-top; corners flip with it. */
.tab.left { left: 0; transform: rotate(180deg); border-radius: 6px 0 0 6px; }
.tab.right { right: 0; border-radius: 6px 0 0 6px; }
.panel {
  position: fixed; top: 0; bottom: 0; z-index: 2147483001;
  display: flex; background: #fff; box-shadow: 0 0 16px rgba(0,0,0,.35);
}
/* DOM order is [iframe, grip]; the grip goes on the edge facing the page. */
.panel.left { left: 0; }
.panel.right { right: 0; flex-direction: row-reverse; }
.grip { width: 6px; cursor: col-resize; background: #c9d1d9; flex: none; }
.grip:hover, .grip.dragging { background: #0b6bcb; }
iframe { border: 0; flex: 1; min-width: 0; height: 100%; background: #fff; color-scheme: normal; }
.panel.dragging iframe { pointer-events: none; }
[hidden] { display: none !important; }
`;

export interface DrawerOptions {
  side: DrawerSide;
  width: number;
  viewerUrl: string;
  onOpen(): void;
  onResize(width: number): void;
}

/** Resizable drawer in a closed Shadow DOM, so Canvas CSS and ours never mix. */
export class Drawer {
  readonly host: HTMLElement;
  iframe: HTMLIFrameElement | null = null;
  private tab: HTMLButtonElement;
  private panel: HTMLDivElement;
  private width: number;

  constructor(private options: DrawerOptions) {
    this.width = options.width;
    this.host = document.createElement('speedview-drawer');
    const root = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;

    this.tab = document.createElement('button');
    this.tab.textContent = 'SpeedView';
    this.tab.title = 'Open SpeedView file viewer';
    this.tab.addEventListener('click', () => this.open());

    this.panel = document.createElement('div');
    this.panel.hidden = true;
    const grip = document.createElement('div');
    grip.className = 'grip';
    grip.title = 'Drag to resize';
    grip.addEventListener('pointerdown', (e) => this.startResize(e, grip));
    this.panel.append(grip);

    root.append(style, this.tab, this.panel);
    this.setSide(options.side);
    this.applyWidth();
    document.documentElement.append(this.host);
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  open(): void {
    if (!this.iframe) {
      this.iframe = document.createElement('iframe');
      this.iframe.src = this.options.viewerUrl;
      this.iframe.allow = 'clipboard-write';
      this.iframe.title = 'SpeedView file viewer';
      this.panel.prepend(this.iframe);
    }
    this.panel.hidden = false;
    this.tab.hidden = true;
    this.options.onOpen();
  }

  close(): void {
    this.panel.hidden = true;
    this.tab.hidden = false;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  setSide(side: DrawerSide): void {
    this.tab.className = `tab ${side}`;
    this.panel.className = `panel ${side}`;
    this.options.side = side;
  }

  setWidth(width: number): void {
    this.width = width;
    this.applyWidth();
  }

  destroy(): void {
    this.host.remove();
  }

  private applyWidth(): void {
    const max = Math.max(MIN_WIDTH, window.innerWidth - 80);
    this.panel.style.width = `${Math.min(Math.max(this.width, MIN_WIDTH), max)}px`;
  }

  private startResize(event: PointerEvent, grip: HTMLElement): void {
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    grip.classList.add('dragging');
    this.panel.classList.add('dragging');
    const move = (e: PointerEvent) => {
      this.width = this.options.side === 'left' ? e.clientX : window.innerWidth - e.clientX;
      this.applyWidth();
    };
    const end = () => {
      grip.classList.remove('dragging');
      this.panel.classList.remove('dragging');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      this.options.onResize(Math.round(parseFloat(this.panel.style.width)));
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }
}
