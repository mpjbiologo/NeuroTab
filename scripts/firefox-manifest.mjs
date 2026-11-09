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
    // 140+: versão a partir da qual o Firefox mostra e controla o consentimento de dados.
    strict_min_version: '140.0',
    // Nada é exigido na instalação. Opcionais, pedidos na hora de usar (src/lib/permissions.js):
    //   locationInfo   → coordenadas das cidades (clima) e endereços (Trânsito)
    //   websiteContent → texto das notas, trechos e páginas enviados ao provedor de IA que a pessoa configurar
    data_collection_permissions: { required: ['none'], optional: ['locationInfo', 'websiteContent'] },
  },
};

fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
console.log('Manifest do Firefox gerado:', file);
