// Copia o leitor de PDF (pdf.js, Apache-2.0) para src/vendor/pdfjs.
// Uso: node scripts/vendor-pdfjs.mjs   (depois de npm install)
// Usado só para ler extratos e faturas em PDF (finanças, #66); é carregado só na hora de importar.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(ROOT, 'src/vendor/pdfjs');
const pkg = dirname(require.resolve('pdfjs-dist/package.json'));
mkdirSync(OUT, { recursive: true });
for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  copyFileSync(join(pkg, 'build', f), join(OUT, f));
  const p = join(OUT, f);
  writeFileSync(p, readFileSync(p, 'utf8').replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n'));
}
writeFileSync(join(OUT, 'LICENSE.txt'), `pdf.js (pdfjs-dist ${require('pdfjs-dist/package.json').version})
https://github.com/mozilla/pdf.js — copiado sem alterações (scripts/vendor-pdfjs.mjs).

` + readFileSync(join(pkg, 'LICENSE'), 'utf8'));
console.log('pdf.js copiado para', OUT);
