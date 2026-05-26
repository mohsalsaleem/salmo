#!/usr/bin/env node
// Server-side render: spin up a DOM in Node, mount <x-page>, capture
// the resulting HTML, write index.html. Re-run when components change.
//
//   node examples/ssr/render.mjs
//
// In production this would be invoked at deploy time (or per-request
// for dynamic content) and the output streamed to the browser.

import { setupDOM, renderToString } from '../../src/ssr.js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

await setupDOM();
await import('./app.js');

const body = renderToString('x-page');

const out = `<!DOCTYPE html>
<html lang="en">
<head>
\t<meta charset="utf-8">
\t<title>SSR demo · mohsal-framework</title>
\t<meta name="viewport" content="width=device-width, initial-scale=1">
\t<style>
\t\tbody { font-family: system-ui, sans-serif; padding: 2rem; max-width: 720px; margin: 0 auto; }
\t\tfieldset { margin-bottom: 1rem; padding: 1rem; border: 1px solid #ddd; border-radius: 6px; }
\t\t.counter { display: inline-flex; align-items: center; gap: 0.75rem; font-size: 1.25rem; }
\t\t.counter button { width: 2rem; height: 2rem; font: inherit; cursor: pointer; }
\t\tx-counter { display: inline-block; }
\t</style>
</head>
<body>
${body}
\t<script type="module" src="./app.js"></script>
</body>
</html>
`;

const here = dirname(fileURLToPath(import.meta.url));
const indexPath = resolve(here, 'index.html');
writeFileSync(indexPath, out);
console.log(`wrote ${indexPath}`);
