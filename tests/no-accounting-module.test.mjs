import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../public/main.js', import.meta.url), 'utf8');
const access = readFileSync(new URL('../public/access.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('general accounting module assets and navigation are completely absent', () => {
  for (const path of [
    '../public/accounting.js',
    '../public/accounting.css',
    '../public/accountant-dashboard.js',
    '../public/accountant-dashboard.css',
    '../public/data/plan-cuentas-predeterminado-ven-nif.json'
  ]) assert.equal(existsSync(new URL(path, import.meta.url)), false, path);
  assert.doesNotMatch(html, /accounting\\.(?:js|css)|accountant-dashboard/);
  assert.doesNotMatch(main, /SIFERAccounting|SIFERAccountantDashboard|openAccountingModule|accountingSourceId|Contabilidad VEN-NIF|accounting:/i);
  assert.doesNotMatch(access, /SIFERAccountantDashboard|accounting|contabilidad/i);
  assert.doesNotMatch(styles, /accounting|accountant|contabilidad|btnAccountingTop/i);
});

test('fiscal operations remain available independently of general accounting', () => {
  assert.match(main, /function seniatSudebanDlg/);
  assert.match(main, /retencionesIva/);
  assert.match(main, /Libro de Ventas Fiscal/);
  assert.match(access, /contador:\['seniat'\]/);
});
