// Converte o manifest do Chromium para o Firefox (Manifest V3).
// Uso: node scripts/firefox-manifest.mjs caminho/manifest.json
import fs from 'node:fs';

const file = process.argv[2];
const m = JSON.parse(fs.readFileSync(file, 'utf8'));

// Firefox usa "scripts" (página de fundo) em vez de service worker.
m.background = { scripts: ['src/background.js'], type: 'module' };

// Permissões que só existem no Chromium.
m.permissions = m.permissions.filter((p) => !['favicon', 'offscreen'].includes(p));

// Ícones dos sites vêm do DuckDuckGo no Firefox.
m.host_permissions = [...new Set([...(m.host_permissions || []), 'https://icons.duckduckgo.com/*'])];

m.browser_specific_settings = {
  gecko: {
    id: 'neurotab@mpjbiologo.github.io',
    strict_min_version: '128.0',
    data_collection_permissions: { required: ['none'] },
  },
};

fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
console.log('Manifest do Firefox gerado:', file);
