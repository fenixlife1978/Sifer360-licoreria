import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../public/main.js', import.meta.url), 'utf8');
const access = readFileSync(new URL('../public/access.js', import.meta.url), 'utf8');

test('header shows a visible logout button for every signed-in role', () => {
  assert.match(html, /id="btnLogout"[^>]*>⇥ Cerrar sesión/);
  assert.match(main, /const logoutButton=\$\('#btnLogout'\);if\(logoutButton\)logoutButton\.addEventListener\('click',\(\)=>\{if\(confirm\('¿Desea cerrar la sesión actual\?'\)\)\{if\(window\.SIFERAccess&&window\.SIFERAccess\.logout\)window\.SIFERAccess\.logout\(\);\}\}\)/);
});

test('logout clears authenticated session and returns to the login screen without closing the cash shift', () => {
  assert.match(access, /function logout\(\)\{sessionStorage\.removeItem\(SESSION\)/);
  assert.match(access, /localStorage\.removeItem\('sifer360_active_box'\)/);
  assert.match(access, /const old=\$\('#sifer-access'\);if\(old\)old\.remove\(\);shell\(\)\}/);
  assert.doesNotMatch(access.slice(access.indexOf('function logout'), access.indexOf('document.addEventListener')), /removeItem\('sifer360_active_opening'\)/);
});
