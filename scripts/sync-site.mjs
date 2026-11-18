// Copia o sistema de design da extensão para o site (docs/assets): tema, fontes e ícones.
// O GitHub Pages só publica a pasta docs/, então o site usa cópias. Uso: node scripts/sync-site.mjs
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
const src = new URL('../src/', import.meta.url);
const dst = new URL('../docs/assets/', import.meta.url);
export const FILES = ['theme.css', 'lib/icons.js', 'lib/icon-data.js', 'lib/icons-LICENSE.txt'];
if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(new URL('fonts/', dst), { recursive: true });
  for (const f of FILES) copyFileSync(new URL(f, src), new URL(f.replace('lib/', ''), dst));
  for (const f of readdirSync(new URL('fonts/', src))) copyFileSync(new URL(`fonts/${f}`, src), new URL(`fonts/${f}`, dst));
  console.log('site sincronizado: docs/assets');
}
