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

// "identity" não pode ser opcional no Firefox (e lá não mostra aviso): vai nas permissões normais.
if ((m.optional_permissions || []).includes('identity')) {
  m.optional_permissions = m.optional_permissions.filter((p) => p !== 'identity');
  m.permissions = [...new Set([...(m.permissions || []), 'identity'])];
}

m.browser_specific_settings = {
  gecko: {
    id: 'neurotab@mpjbiologo.github.io',
    // 140+: versão a partir da qual o Firefox mostra e controla o consentimento de dados.
    strict_min_version: '140.0',
    // Nada é exigido na instalação. Opcionais, pedidos na hora de usar (src/lib/permissions.js):
    //   locationInfo   → coordenadas das cidades (clima) e endereços (Trânsito)
    //   websiteContent → texto das notas, trechos e páginas enviados ao provedor de IA que a pessoa configurar
    //   bookmarksInfo  → atalhos e grupos enviados à pasta da NeuroTab no Google Drive (sincronização)
    data_collection_permissions: { required: ['none'], optional: ['locationInfo', 'websiteContent', 'bookmarksInfo'] },
  },
};

fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
console.log('Manifest do Firefox gerado:', file);
