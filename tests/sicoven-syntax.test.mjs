import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
test('diagnóstico sintáctico sicoven', () => {
 const source=fs.readFileSync(new URL('../public/sicoven.js',import.meta.url),'utf8');
 try { new vm.Script(source); } catch (e) { console.error(e.stack); throw e; }
});
