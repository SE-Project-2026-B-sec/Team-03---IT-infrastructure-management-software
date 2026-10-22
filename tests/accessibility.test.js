'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer } = require('./helpers');

const PUBLIC = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(PUBLIC, 'styles.css'), 'utf8');

/** WCAG 2.1 relative luminance contrast ratio between two #rrggbb colours. */
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, b2] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function tokens(block) {
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toLowerCase()]));
}

test('TC-UX-01 dashboard meets the automated WCAG 2.1 AA checks', async () => {
  // Document structure and landmarks.
  assert.match(html, /<html lang="en">/, 'page language is declared');
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /<a class="skip-link" href="#main">/, 'skip link to main content');
  assert.match(html, /<main id="main"/);
  assert.match(html, /role="status" aria-live="polite"/, 'status messages are announced');

  // Every form control has a programmatic label.
  const inputIds = [...html.matchAll(/<input id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(inputIds.length >= 3);
  for (const id of inputIds) assert.match(html, new RegExp(`<label for="${id}">[^<]+</label>`), `input #${id} has a label`);
  for (const m of html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)) assert.ok(m[1].trim().length > 0, 'buttons have text');

  // Data tables have captions and header scopes; headings are in order.
  const tables = (html.match(/<table[\s>]/g) || []).length;
  assert.ok(tables >= 2);
  assert.equal((html.match(/<caption/g) || []).length, tables, 'every table has a caption');
  assert.ok(!/<th(?=[\s>])(?![^>]*scope=)/.test(html), 'all header cells declare scope');
  assert.ok((html.match(/<th scope="col">/g) || []).length >= 9);
  const levels = [...html.matchAll(/<h([1-6])/g)].map((m) => Number(m[1]));
  assert.equal(levels[0], 1);
  levels.forEach((l, i) => assert.ok(i === 0 || l <= levels[i - 1] + 1, 'no skipped heading levels'));

  // No inline script or style (also required by the Content-Security-Policy).
  assert.ok(!/<script>(?!<\/script>)/.test(html) && !/ style="/.test(html) && !/ on[a-z]+="/.test(html));

  // Colour contrast of the design tokens, light and dark themes (4.5:1 for text).
  const block = (re) => {
    const m = re.exec(css);
    assert.ok(m, `theme block not found: ${re}`);
    return tokens(m[1]);
  };
  const light = block(/^:root\s*\{([^}]*)\}/m);
  const dark = block(/^:root\[data-theme="dark"\]\s*\{([^}]*)\}/m);
  const darkMedia = block(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:where\(:not\(\[data-theme="light"\]\)\)\s*\{([^}]*)\}/);
  assert.deepEqual(darkMedia, dark, 'OS dark mode and the dark toggle use identical tokens');
  const tint = Number((/\.pill\s*\{[^}]*color-mix\(in srgb, currentColor (\d+)%, transparent\)/.exec(css) || [])[1]);
  assert.ok(tint > 0, 'status pill tint percentage found');
  const over = (fg, bg, share) => `#${[1, 3, 5].map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16) * share + parseInt(bg.slice(i, i + 2), 16) * (1 - share)).toString(16).padStart(2, '0')).join('')}`;
  for (const [name, theme] of [['light', light], ['dark', dark]]) {
    const pairs = [
      ['fg', 'bg'], ['fg', 'surface'], ['fg', 'surface-2'], ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-2'],
      ['accent-fg', 'accent'], ['accent-fg', 'accent-2'], ['accent', 'surface'],
      ['ok', 'surface'], ['warn', 'surface'], ['bad', 'surface'], ['info', 'surface']
    ];
    for (const [fg, bg] of pairs) {
      const ratio = contrast(theme[fg], theme[bg]);
      assert.ok(ratio >= 4.5, `${name}: --${fg} on --${bg} is ${ratio.toFixed(2)}:1 (needs 4.5:1)`);
    }
    for (const tone of ['ok-mark', 'warn-mark', 'bad-mark']) {
      const ratio = contrast(theme[tone], theme.surface);
      assert.ok(ratio >= 3, `${name}: --${tone} graphic on --surface is ${ratio.toFixed(2)}:1 (needs 3:1)`);
    }
    // Status pills: coloured text on a tint of the same colour over each surface.
    for (const tone of ['ok', 'warn', 'bad', 'info', 'accent', 'muted']) {
      for (const surface of ['surface', 'surface-2']) {
        const ratio = contrast(theme[tone], over(theme[tone], theme[surface], tint / 100));
        assert.ok(ratio >= 4.5, `${name}: ${tone} pill on --${surface} is ${ratio.toFixed(2)}:1 (needs 4.5:1)`);
      }
    }
  }
  assert.match(css, /:focus-visible\s*{[^}]*outline/, 'visible keyboard focus indicator');

  // The page is actually served with the hardening headers.
  const s = await startServer();
  try {
    const page = await s.request('GET', '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    for (const asset of ['/app.js', '/styles.css']) assert.equal((await s.request('GET', asset)).status, 200);
  } finally {
    await s.stop();
  }
});
