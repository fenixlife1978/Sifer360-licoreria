import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('portable Electron carga todos los recursos de interfaz con rutas relativas', () => {
  for (const asset of ['logo.svg', 'styles.css', 'access.css', 'sifer360-cashea.css', 'sql-wasm.js', 'main.js', 'access.js']) {
    assert.match(html, new RegExp('(?:href|src)="./' + asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"'), asset);
    assert.equal(existsSync(new URL('../public/' + asset, import.meta.url)), true, asset);
  }
  assert.doesNotMatch(html, /(?:href|src)="\/(?:logo\.svg|styles\.css|access\.css|sifer360-cashea\.css|sql-wasm\.js|main\.js|access\.js)"/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(vite, /base:\s*['"]\.\/['"]/);
});

test('el POS no depende de fuentes inexistentes ni de servicios externos', () => {
  assert.doesNotMatch(css, /url\(["']?fonts\//i);
  assert.match(css, /--ui\s*:/);\n  assert.match(css, /--mono\s*:/);
});
