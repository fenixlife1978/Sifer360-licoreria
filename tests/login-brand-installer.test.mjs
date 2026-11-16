import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const access=readFileSync(new URL('../public/access.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/access.css',import.meta.url),'utf8');
const builder=JSON.parse(readFileSync(new URL('../electron-builder.json',import.meta.url),'utf8'));
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));

test('login presents horizontal SIFER360 logo, username/email, password and submit only',()=>{
 assert.match(access,/sa-brand-logo"><img src="\.\/logo-horizontal\.svg"/);
 assert.match(access,/USUARIO \/ CORREO ELECTRÓNICO/);
 assert.match(access,/id="sa-code" type="password"/);
 assert.match(access,/<span>Iniciar Sesión<\/span>/);
 assert.match(css,/login-waves-yellow\.svg/);
 assert.match(css,/\.sa-field:nth-of-type\(3\) \{ display:none/);
 assert.match(css,/\.sa-remember \{ display:none/);
});
test('Windows distribution includes installable NSIS setup with desktop shortcut and portable EXE',()=>{
 const targets=builder.win.target.map(x=>x.target);
 assert.ok(targets.includes('portable'));
 assert.ok(targets.includes('nsis'));
 assert.equal(builder.nsis.createDesktopShortcut,true);
 assert.equal(builder.nsis.createStartMenuShortcut,true);
 assert.match(pkg.scripts['build:exe'],/electron-builder --win --config/);
});
