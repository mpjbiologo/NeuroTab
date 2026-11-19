// Copia o leitor de texto local (Tesseract.js, Apache-2.0) para src/vendor/tesseract.
// Uso: node scripts/vendor-tesseract.mjs   (depois de npm install)
// Só o motor vai no pacote; o idioma (≈1,4–3 MB) é baixado uma vez, no primeiro uso, e fica guardado.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(ROOT, 'src/vendor/tesseract');
const js = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(require.resolve('tesseract.js-core/package.json'));
mkdirSync(OUT, { recursive: true });
const files = [
  [join(js, 'dist/tesseract.esm.min.js'), 'tesseract.esm.min.js'],
  [join(js, 'dist/worker.min.js'), 'worker.min.js'],
  [join(core, 'tesseract-core-simd-lstm.js'), 'tesseract-core-simd-lstm.js'],
  [join(core, 'tesseract-core-simd-lstm.wasm'), 'tesseract-core-simd-lstm.wasm'],
];
for (const [from, to] of files) copyFileSync(from, join(OUT, to));
// Sem o comentário do mapa de origem (o .map não vai no pacote).
for (const f of ['tesseract.esm.min.js', 'worker.min.js']) {
  const p = join(OUT, f);
  writeFileSync(p, readFileSync(p, 'utf8').replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n'));
}
const v = (p) => require(p + '/package.json').version;
writeFileSync(join(OUT, 'LICENSE.txt'), `Tesseract.js ${v('tesseract.js')} e tesseract.js-core ${v('tesseract.js-core')}
https://github.com/naptha/tesseract.js — copiados sem alterações (scripts/vendor-tesseract.mjs).

` + readFileSync(join(core, 'LICENSE'), 'utf8'));
console.log('Tesseract copiado para', OUT);
