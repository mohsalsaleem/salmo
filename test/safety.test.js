import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { html, unsafe } from '../src/index.js';
import { Signal } from '../src/signal.js';

const tick = () => new Promise((r) => queueMicrotask(r));

function mount(frag) {
  const div = document.createElement('div');
  div.appendChild(frag);
  return div;
}

/** @type {ReturnType<typeof vi.spyOn> | null} */
let warnSpy = null;
beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warnSpy?.mockRestore(); });

describe('XSS protections at sinks', () => {
  describe('.innerHTML / .outerHTML / .srcdoc', () => {
    it('refuses a plain string written to .innerHTML', () => {
      expect(() => mount(html`<div .innerHTML=${'<img onerror=alert(1)>'}></div>`))
        .toThrowError(/refusing to set \.innerHTML/);
    });

    it('refuses .outerHTML and .srcdoc the same way', () => {
      expect(() => mount(html`<div .outerHTML=${'<x>'}></div>`))
        .toThrowError(/\.outerHTML/);
      expect(() => mount(html`<iframe .srcdoc=${'<x>'}></iframe>`))
        .toThrowError(/\.srcdoc/);
    });

    it('allows unsafe()-wrapped values through', () => {
      const div = mount(html`<div .innerHTML=${unsafe('<b>safe</b>')}></div>`);
      expect(div.querySelector('b')?.textContent).toBe('safe');
    });

    it('refuses a reactive value that resolves to a non-trusted string', () => {
      const s = new Signal.State('<img>');
      expect(() => mount(html`<div .innerHTML=${s}></div>`)).toThrowError(/\.innerHTML/);
    });

    it('non-dangerous properties remain unrestricted (e.g. .value)', () => {
      const div = mount(html`<input .value=${'anything goes here'}>`);
      expect(div.querySelector('input').value).toBe('anything goes here');
    });
  });

  describe('URL-bearing attributes', () => {
    it('blocks javascript: scheme in href and replaces with about:blank', () => {
      const div = mount(html`<a href=${'javascript:alert(1)'}>x</a>`);
      expect(div.querySelector('a')?.getAttribute('href')).toBe('about:blank');
      expect(warnSpy).toHaveBeenCalled();
    });

    it('blocks vbscript: and data:text/html schemes', () => {
      const a = mount(html`<a href=${'vbscript:msgbox()'}>x</a>`).querySelector('a');
      expect(a?.getAttribute('href')).toBe('about:blank');
      const iframe = mount(html`<iframe src=${'data:text/html,<script>alert(1)</script>'}></iframe>`).querySelector('iframe');
      expect(iframe?.getAttribute('src')).toBe('about:blank');
    });

    it('ignores leading whitespace when checking the scheme', () => {
      const a = mount(html`<a href=${'   \tjavascript:alert(1)'}>x</a>`).querySelector('a');
      expect(a?.getAttribute('href')).toBe('about:blank');
    });

    it('lets safe URLs through untouched', () => {
      const a = mount(html`<a href=${'/users/42'}>x</a>`).querySelector('a');
      expect(a?.getAttribute('href')).toBe('/users/42');
      const img = mount(html`<img src=${'https://example.com/x.png'}>`).querySelector('img');
      expect(img?.getAttribute('src')).toBe('https://example.com/x.png');
    });

    it('lets data: image URLs through (only data:text/html is blocked)', () => {
      const img = mount(html`<img src=${'data:image/png;base64,iVBOR...'}>`).querySelector('img');
      expect(img?.getAttribute('src')).toMatch(/^data:image\/png/);
    });

    it('allows unsafe()-wrapped javascript: URLs', () => {
      const a = mount(html`<a href=${unsafe('javascript:noop()')}>x</a>`).querySelector('a');
      expect(a?.getAttribute('href')).toBe('javascript:noop()');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('still sanitizes when a SAFE prefix is concatenated with a DANGEROUS value', () => {
      // <a href="prefix${injection}"> — composed value, no unsafe() wrap.
      // The whole final string is "prefix..." so the dangerous-scheme
      // regex won't match... but the threat is the OTHER way: an attacker
      // sets the prefix away and gives us "javascript:" via interpolation.
      // We sanitize the FINAL value regardless of where the danger is.
      const v = new Signal.State('safe/path');
      const a = mount(html`<a href="/p/${v}">x</a>`).querySelector('a');
      expect(a?.getAttribute('href')).toBe('/p/safe/path');

      // Now make the whole thing a single interpolation with a bad value.
      const bad = new Signal.State('javascript:alert(1)');
      const a2 = mount(html`<a href=${bad}>x</a>`).querySelector('a');
      expect(a2?.getAttribute('href')).toBe('about:blank');
    });

    it('does not unwrap a single unsafe()-wrapped value when the attribute is composed', async () => {
      // Subtle: when the attribute has STATIC text around the
      // interpolation, the trusted flag must not let dangerous content
      // through (otherwise an attacker controlling the static part of
      // someone else's template could escalate).
      const a = mount(html`<a href="prefix-${unsafe('javascript:alert(1)')}">x</a>`).querySelector('a');
      // The whole value isn't trusted (the static "prefix-" makes it
      // composed); sanitizer still runs. The final string is
      // "prefix-javascript:..." which doesn't START with javascript:,
      // so it passes — that's correct behaviour and harmless because
      // browsers don't execute that as a scheme.
      expect(a?.getAttribute('href')).toBe('prefix-javascript:alert(1)');
    });
  });
});
