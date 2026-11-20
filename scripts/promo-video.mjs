// Vídeo de divulgação vertical (1080×1920, para celular: Reels, Status, Shorts), com textos na tela.
// Usa os vídeos de docs/video/ (gerados por scripts/demo-videos.mjs), com zoom na parte que importa
// (recorte [x, y, largura] em 16:10 da tela de 1280×800), e monta as telas em HTML.
// Uso: node scripts/promo-video.mjs [pt|en|es]   →   docs/video/promo-vertical[-en|-es].mp4
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const VID = ROOT + 'docs/video/';
const TMP = '/tmp/neurotab-promo/';
const W = 1080, H = 1920;
const CLIP = { x: 40, y: 660, w: 1000, h: 625 }; // 16:10

const TEXT = {
  pt: {
    intro: ['Sua nova aba virou um <em>segundo cérebro</em>', 'Notas, lembretes, agenda e IA, no navegador do seu computador'],
    scenes: [
      ['atalhos', 1.5, 9, 'Seus atalhos, <em>sem bagunça</em>', 'Passe o mouse num grupo e eles aparecem', [0, 0, 768]],
      ['voz', 1.45, 11, 'Fale com a <em>nova aba</em>', '“Me lembre amanhã às 9h…” vira lembrete', [240, 270, 928]],
      ['busca', 1.45, 9.2, 'Ache tudo com <em>Ctrl+K</em>', 'Notas, atalhos, web e até contas', [200, 200, 880]],
      ['agenda', 1.9, 20, 'Sua agenda <em>junto</em>', 'Com Google Agenda: crie e edite daqui', [60, 250, 880]],
    ],
    outro: ['Grátis e <em>sem anúncios</em>', 'Instale no computador:', 'mpjbiologo.github.io/NeuroTab'],
    pills: ['Chrome', 'Edge', 'Firefox'],
  },
};

const FONTS = `
@font-face { font-family: 'Space Grotesk'; src: url('${ROOT}docs/assets/fonts/space-grotesk-latin-wght-normal.woff2') format('woff2'); font-weight: 300 700; }
@font-face { font-family: 'Inter'; src: url('${ROOT}docs/assets/fonts/inter-latin-wght-normal.woff2') format('woff2'); font-weight: 100 900; }`;

const BASE = `${FONTS}
* { box-sizing: border-box; margin: 0; }
html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
body { background: #0d0b1f; color: #fff; font-family: Inter, sans-serif; position: relative; }
.bg { position: absolute; inset: 0; background:
  radial-gradient(900px 900px at 10% 8%, rgba(60,70,190,.75), transparent 70%),
  radial-gradient(800px 800px at 95% 30%, rgba(150,50,170,.6), transparent 70%),
  radial-gradient(1000px 900px at 50% 100%, rgba(20,140,150,.45), transparent 70%); }
.brand { position: absolute; top: 96px; left: 0; right: 0; display: flex; justify-content: center; align-items: center; gap: 22px; }
.brand img { width: 84px; height: 84px; border-radius: 20px; }
.brand b { font: 700 58px 'Space Grotesk'; letter-spacing: -1px; }
h1 { font: 700 84px/1.05 'Space Grotesk'; letter-spacing: -2px; text-align: center; padding: 0 70px; }
h1 em { font-style: normal; background: linear-gradient(90deg, #7cf3ff, #b48cff); -webkit-background-clip: text; color: transparent; }
.sub { font: 500 46px/1.3 Inter; color: #d9d6f2; text-align: center; padding: 0 80px; }
.pills { position: absolute; bottom: 150px; left: 0; right: 0; display: flex; justify-content: center; gap: 18px; }
.pills span { font: 600 36px Inter; padding: 14px 30px; border-radius: 999px; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.22); }
`;

const logo = `${ROOT}docs/store/logo-300x300.png`;
const brand = `<div class="brand"><img src="${logo}"><b>NeuroTab</b></div>`;

function sceneHTML(title, sub, pills) {
  return `<style>${BASE}
  .head { position: absolute; top: 300px; left: 0; right: 0; height: 300px; display: flex; align-items: center; justify-content: center; }
  .card { position: absolute; left: ${CLIP.x - 6}px; top: ${CLIP.y - 6}px; width: ${CLIP.w + 12}px; height: ${CLIP.h + 12}px; border-radius: 34px; background: rgba(255,255,255,.16); box-shadow: 0 40px 90px rgba(0,0,0,.6); }
  .foot { position: absolute; top: ${CLIP.y + CLIP.h + 60}px; left: 0; right: 0; }
  </style><div class="bg"></div>${brand}<div class="head"><h1>${title}</h1></div><div class="card"></div><div class="foot"><p class="sub">${sub}</p></div>
  <div class="pills">${pills.map((p) => `<span>${p}</span>`).join('')}</div>`;
}

function introHTML([title, sub], pills) {
  return `<style>${BASE}
  .mid { position: absolute; top: 420px; left: 0; right: 0; display: grid; justify-items: center; gap: 70px; }
  .mid img { width: 300px; height: 300px; border-radius: 70px; box-shadow: 0 40px 120px rgba(124,92,255,.55); }
  </style><div class="bg"></div><div class="mid"><img src="${logo}"><h1>${title}</h1><p class="sub">${sub}</p></div>
  <div class="pills">${pills.map((p) => `<span>${p}</span>`).join('')}</div>`;
}

function outroHTML([title, a, url], pills) {
  return `<style>${BASE}
  .mid { position: absolute; top: 360px; left: 0; right: 0; display: grid; justify-items: center; gap: 60px; }
  .mid img { width: 260px; height: 260px; border-radius: 60px; box-shadow: 0 40px 120px rgba(124,92,255,.55); }
  .url { font: 700 54px 'Space Grotesk'; padding: 26px 40px; border-radius: 26px; background: linear-gradient(90deg, #2fd6e6, #8b6cff); color: #0d0b1f; }
  </style><div class="bg"></div><div class="mid"><img src="${logo}"><h1>${title}</h1><p class="sub">${a}</p><div class="url">${url}</div></div>
  <div class="pills">${pills.map((p) => `<span>${p}</span>`).join('')}</div>`;
}

const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
const ENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '30'];
const FADE = (d) => `fade=t=in:st=0:d=0.35,fade=t=out:st=${(d - 0.35).toFixed(2)}:d=0.35`;

async function build(lang) {
  const T = TEXT[lang];
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const render = async (html, file) => {
    writeFileSync(TMP + 'page.html', `<!doctype html><meta charset="utf-8">${html}`);
    await page.goto('file://' + TMP + 'page.html');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await page.screenshot({ path: file });
  };
  // máscara de cantos arredondados para os vídeos
  await page.setViewportSize({ width: CLIP.w, height: CLIP.h });
  writeFileSync(TMP + 'page.html', `<body style="margin:0;background:#000"><div style="width:${CLIP.w}px;height:${CLIP.h}px;border-radius:28px;background:#fff"></div>`);
  await page.goto('file://' + TMP + 'page.html');
  await page.screenshot({ path: TMP + 'mask.png' });
  await page.setViewportSize({ width: W, height: H });

  const parts = [];
  // abertura
  await render(introHTML(T.intro, T.pills), TMP + 'intro.png');
  ff(['-loop', '1', '-t', '3.4', '-i', TMP + 'intro.png', '-vf', `scale=${W}:${H},${FADE(3.4)}`, ...ENC, TMP + 'p0.mp4']);
  parts.push(TMP + 'p0.mp4');
  // cenas com os vídeos
  for (const [i, [name, speed, maxIn, title, sub, [cx, cy, cw]]] of T.scenes.entries()) {
    await render(sceneHTML(title, sub, T.pills), TMP + `s${i}.png`);
    const src = VID + `demo-${name}.mp4`;
    const dur = Math.min(maxIn, +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).toString()) / speed;
    const out = TMP + `p${i + 1}.mp4`;
    ff(['-loop', '1', '-i', TMP + `s${i}.png`, '-t', String(maxIn), '-i', src, '-loop', '1', '-i', TMP + 'mask.png',
      '-filter_complex', `[1:v]setpts=PTS/${speed},crop=${cw}:${Math.round(cw * 0.625)}:${cx}:${cy},scale=${CLIP.w}:${CLIP.h}:flags=lanczos,format=rgba[c];[2:v]format=gray,scale=${CLIP.w}:${CLIP.h}[m];[c][m]alphamerge[cm];[0:v][cm]overlay=${CLIP.x}:${CLIP.y}:shortest=1,${FADE(dur)}[v]`,
      '-map', '[v]', '-t', dur.toFixed(2), ...ENC, out]);
    parts.push(out);
  }
  // fechamento
  await render(outroHTML(T.outro, T.pills), TMP + 'outro.png');
  ff(['-loop', '1', '-t', '4.6', '-i', TMP + 'outro.png', '-vf', `scale=${W}:${H},fade=t=in:st=0:d=0.35`, ...ENC, TMP + 'p9.mp4']);
  parts.push(TMP + 'p9.mp4');
  await browser.close();

  writeFileSync(TMP + 'list.txt', parts.map((p) => `file '${p}'`).join('\n'));
  const out = VID + `promo-vertical${lang === 'pt' ? '' : '-' + lang}.mp4`;
  ff(['-f', 'concat', '-safe', '0', '-i', TMP + 'list.txt', '-c', 'copy', '-movflags', '+faststart', out]);
  ff(['-ss', '1.5', '-i', out, '-frames:v', '1', '-q:v', '3', out.replace(/\.mp4$/, '.jpg')]);
  const total = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString();
  console.log(`✓ ${out.replace(ROOT, '')} (${(statSync(out).size / 1024 / 1024).toFixed(1)} MB, ${total.toFixed(1)} s)`);
}

for (const lang of process.argv.slice(2).length ? process.argv.slice(2) : ['pt']) await build(lang);
