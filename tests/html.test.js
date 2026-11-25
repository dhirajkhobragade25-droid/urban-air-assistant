import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const jsDir = new URL('../js/', import.meta.url);

/** Every module under js/, as a path relative to the site root ("js/ui/state.js"). */
function modules() {
  return readdirSync(jsDir, { recursive: true })
    .filter((path) => path.endsWith('.js'))
    .map((path) => `js/${path.split('\\').join('/')}`);
}

test('the page loads js/app.js as its one module entry point and preloads every other module', () => {
  assert.match(html, /<script type="module" src="js\/app\.js"><\/script>/);
  const preloaded = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]);
  const expected = modules().filter((path) => path !== 'js/app.js');
  assert.deepEqual([...preloaded].sort(), [...expected].sort(), 'each module has exactly one modulepreload link');
  assert.equal(new Set(preloaded).size, preloaded.length, 'no module is preloaded twice');
});
