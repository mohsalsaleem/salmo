// <framework-devtools> — drop-in overlay for federation introspection.
//
//   <framework-devtools></framework-devtools>
//
// Renders a fixed-position panel in the bottom-right of the page
// listing every federated component (registered via lazyComponent or
// loadFromManifest), its remote source, and the number of live
// instances on the current page. Click a row to highlight its
// instances; click again to clear.
//
// Pure dev tooling — load only in dev environments. The panel renders
// in shadow DOM so its styles are isolated from the host page.

import { _getRegistry, _onRegistryChange } from './lazy.js';
import { VERSION } from './version.js';

const STYLE = `
  :host {
    position: fixed;
    bottom: 12px;
    right: 12px;
    z-index: 2147483646;
    font: 12px/1.4 ui-monospace, monospace;
    color: #ddd;
  }
  .panel {
    background: rgba(20, 22, 28, 0.96);
    color: #ddd;
    border-radius: 8px;
    padding: 0;
    min-width: 280px;
    max-width: 360px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.4);
    overflow: hidden;
    backdrop-filter: blur(10px);
  }
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 10px;
    background: rgba(255,255,255,0.06);
    border-bottom: 1px solid rgba(255,255,255,0.05);
    cursor: pointer; user-select: none;
  }
  .header strong { color: #66bbff; font-weight: 600; }
  .header small { color: #888; }
  .body { padding: 6px 0; max-height: 50vh; overflow: auto; }
  .empty { padding: 12px; color: #888; font-style: italic; }
  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    cursor: pointer;
    border-bottom: 1px solid rgba(255,255,255,0.04);
  }
  .row:last-child { border-bottom: none; }
  .row:hover { background: rgba(255,255,255,0.06); }
  .row.active { background: rgba(102, 187, 255, 0.18); }
  .tag { color: #6f6; font-weight: 600; }
  .src {
    grid-column: 1 / 3;
    font-size: 10px;
    color: #888;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    background: rgba(102,187,255,0.2);
    color: #66bbff;
    padding: 1px 6px;
    border-radius: 8px;
    font-size: 10px;
  }
  .footer {
    padding: 6px 10px;
    border-top: 1px solid rgba(255,255,255,0.05);
    color: #666;
    font-size: 10px;
    display: flex; justify-content: space-between;
  }
`;

const HIGHLIGHT_ATTR = 'data-salmo-devtools-highlight';

class FrameworkDevtools extends HTMLElement {
  /** @type {ShadowRoot} */ #root;
  /** @type {string | null} */ #activeTag = null;
  #collapsed = false;
  /** @type {(() => void) | null} */ #unsubRegistry = null;
  /** @type {MutationObserver | null} */ #observer = null;
  #renderScheduled = false;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.#render();
    // Re-render the moment a new lazyComponent is registered.
    this.#unsubRegistry = _onRegistryChange(() => this.#scheduleRender());
    // Re-render when the document mutates so live counts stay fresh.
    // Microtask-coalesced via #scheduleRender so a burst of mutations
    // (e.g. a list re-render swapping 100 children) costs one render.
    this.#observer = new MutationObserver(() => this.#scheduleRender());
    this.#observer.observe(document.body, { childList: true, subtree: true });
    // Style block for highlight (injected once into the host document)
    if (!document.querySelector(`style[data-salmo-devtools]`)) {
      const s = document.createElement('style');
      s.dataset.salmoDevtools = '';
      s.textContent = `[${HIGHLIGHT_ATTR}] { outline: 2px solid #66bbff !important; outline-offset: 2px; }`;
      document.head.appendChild(s);
    }
  }

  disconnectedCallback() {
    this.#unsubRegistry?.();
    this.#unsubRegistry = null;
    this.#observer?.disconnect();
    this.#observer = null;
    this.#clearHighlight();
  }

  #scheduleRender() {
    if (this.#renderScheduled) return;
    this.#renderScheduled = true;
    queueMicrotask(() => {
      this.#renderScheduled = false;
      if (this.isConnected) this.#render();
    });
  }

  #render() {
    const entries = [...(_getRegistry().entries())];
    const rows = entries.map(([tag, info]) => {
      const liveCount = document.querySelectorAll(tag).length;
      const active = this.#activeTag === tag;
      return `
        <div class="row${active ? ' active' : ''}" data-tag="${tag}">
          <span class="tag">&lt;${tag}&gt;</span>
          <span class="count">${liveCount}</span>
          <span class="src" title="${escape(info.src)}">${escape(info.src)}</span>
        </div>
      `;
    }).join('');

    this.#root.innerHTML = `
      <style>${STYLE}</style>
      <div class="panel">
        <div class="header" data-action="toggle">
          <strong>salmo</strong>
          <small>v${VERSION} · ${entries.length} federated</small>
        </div>
        ${this.#collapsed ? '' : `
          <div class="body">
            ${entries.length === 0 ? `<div class="empty">No federated components registered yet.</div>` : rows}
          </div>
          <div class="footer">
            <span>click a row to highlight</span>
            <span>${entries.length} total</span>
          </div>
        `}
      </div>
    `;

    this.#root.querySelector('.header')?.addEventListener('click', () => {
      this.#collapsed = !this.#collapsed;
      this.#render();
    });

    for (const row of this.#root.querySelectorAll('.row')) {
      row.addEventListener('click', (e) => {
        const tag = /** @type {HTMLElement} */ (e.currentTarget).dataset.tag;
        if (!tag) return;
        if (this.#activeTag === tag) {
          this.#activeTag = null;
          this.#clearHighlight();
        } else {
          this.#activeTag = tag;
          this.#highlight(tag);
        }
        this.#render();
      });
    }
  }

  /** @param {string} tag */
  #highlight(tag) {
    this.#clearHighlight();
    for (const el of document.querySelectorAll(tag)) {
      el.setAttribute(HIGHLIGHT_ATTR, '');
    }
  }

  #clearHighlight() {
    for (const el of document.querySelectorAll(`[${HIGHLIGHT_ATTR}]`)) {
      el.removeAttribute(HIGHLIGHT_ATTR);
    }
  }
}

/** @param {string} s */
function escape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
}

customElements.define('framework-devtools', FrameworkDevtools);
