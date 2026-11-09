// Confere o manifest com o mapa de permissões (lib/permissions.js) e o pacote do Firefox.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FEATURES } from '../../src/lib/permissions.js';

const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const all = (pred) => Object.values(FEATURES).filter(pred).flatMap((f) => f.origins);

test('acessos obrigatórios = recursos marcados como obrigatórios', () => {
  assert.deepEqual([...manifest.host_permissions].sort(), all((f) => f.required).sort());
});

test('todo acesso opcional pertence a um recurso documentado', () => {
  const known = new Set(all((f) => !f.required));
  for (const o of manifest.optional_host_permissions) assert.ok(known.has(o), `sem justificativa: ${o}`);
  for (const o of known) assert.ok(manifest.optional_host_permissions.includes(o), `recurso sem permissão no manifest: ${o}`);
});

test('sem acesso amplo obrigatório e sem http://*/*', () => {
  const everything = [...manifest.host_permissions, ...manifest.optional_host_permissions];
  assert.ok(!everything.includes('http://*/*'));
  assert.ok(!everything.includes('<all_urls>'));
  assert.ok(!manifest.host_permissions.some((o) => o.includes('*://*') || o === 'https://*/*'));
});

test('permissões de API usadas no código', () => {
  const used = execFileSync('grep', ['-rhoE', 'chrome\\.(contextMenus|alarms|notifications|offscreen|scripting|topSites|sessions|tabs|storage)\\b', 'src'], { cwd: root.pathname }).toString();
  for (const p of ['contextMenus', 'alarms', 'notifications', 'offscreen', 'scripting', 'storage']) {
    assert.ok(manifest.permissions.includes(p), `falta ${p}`);
    assert.ok(used.includes('chrome.' + p), `${p} declarada mas não usada`);
  }
  for (const p of manifest.optional_permissions) assert.ok(used.includes('chrome.' + p), `${p} opcional não usada`);
});

test('manifest do Firefox é gerado corretamente', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nt-ff-'));
  const file = join(dir, 'manifest.json');
  writeFileSync(file, JSON.stringify(manifest));
  execFileSync('node', [new URL('scripts/firefox-manifest.mjs', root).pathname, file]);
  const ff = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(ff.background, { scripts: ['src/background.js'], type: 'module' });
  assert.ok(!ff.permissions.includes('offscreen') && !ff.permissions.includes('favicon'));
  assert.equal(ff.browser_specific_settings.gecko.id, 'neurotab@mpjbiologo.github.io');
  assert.ok(ff.host_permissions.includes('https://icons.duckduckgo.com/*'));
});
