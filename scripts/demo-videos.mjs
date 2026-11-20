// Grava os vídeos curtos de demonstração do site (docs/video/), com a extensão rodando de verdade.
// Uso: node scripts/demo-videos.mjs [atalhos|voz|busca|agenda …]   (sem argumentos: todos)
// Tudo é simulado como nas capturas (scripts/screenshots.mjs): relógio fixo, clima, conteúdo de exemplo.
// Nada sai para a internet e nenhuma tela de terceiros (Google etc.) aparece.
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scene, NOW, HOUR } from './screenshots.mjs';

// campos de data e hora no formato brasileiro (o Chromium sem janela usa o idioma do sistema)
Object.assign(process.env, { LANG: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR:pt', LC_ALL: 'pt_BR.UTF-8' });
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = ROOT + 'docs/video/';
const RAW = '/tmp/neurotab-videos/';
const SIZE = { width: 1280, height: 800 };
// Sem emular o tamanho: a janela real (com 144 px de barras) deixa a página com 1280×800, e o screencast do
// Chrome grava exatamente isso. Emulando, ele grava só a parte de cima.
const WINDOW = { viewport: null, args: [`--window-size=${SIZE.width},${SIZE.height + 144}`] };
mkdirSync(OUT, { recursive: true });

// Cursor visível (a gravação sem janela não mostra o do sistema). Fica acima até das caixas de diálogo.
const CURSOR = () => {
  const make = () => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div');
    c.id = '__cur';
    c.popover = 'manual';
    c.style.cssText = 'position:fixed;inset:auto;left:-40px;top:-40px;margin:0;padding:0;width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,.92);border:3px solid #7c5cff;box-shadow:0 2px 10px rgba(0,0,0,.45);pointer-events:none;transform:translate(-50%,-50%);transition:scale .12s;overflow:visible';
    document.body.append(c);
    const raise = () => { try { c.hidePopover(); c.showPopover(); } catch { /* sem popover */ } };
    raise();
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { c.style.scale = '.7'; }, true);
    addEventListener('mouseup', () => { c.style.scale = '1'; }, true);
    new MutationObserver(raise).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'], childList: true });
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', make); else make();
};

const wait = (p, ms) => p.waitForTimeout(ms);
/** Move o mouse devagar até o centro de um elemento. */
async function glide(p, target, { steps = 22 } = {}) {
  const box = typeof target === 'string' ? await p.locator(target).first().boundingBox() : await target.boundingBox();
  if (!box) throw new Error('sem posição para ' + target);
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
}
async function click(p, target, opts) { await glide(p, target, opts); await wait(p, 180); await p.mouse.down(); await wait(p, 90); await p.mouse.up(); }

/** Abre uma página nova, grava a tela dela (screencast do Chrome) durante a demonstração e salva o MP4. */
async function record(name, x, demo, { path = 'src/newtab.html' } = {}) {
  await x.ctx.addInitScript(CURSOR);
  const p = await x.open(path, { wait: 1500 });
  await p.mouse.move(SIZE.width * 0.62, SIZE.height * 0.55);
  await wait(p, 300);
  mkdirSync(RAW, { recursive: true });
  if ((await p.evaluate(() => innerHeight)) !== SIZE.height) throw new Error('a página não ficou com ' + SIZE.height + ' px de altura');
  mkdirSync(RAW, { recursive: true });
  const cdp = await x.ctx.newCDPSession(p);
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => {
    const file = `${RAW}f${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 });
  await wait(p, 400);
  // legendas: cue('texto') marca o começo de cada uma; cada uma vai até a próxima (ou o fim)
  const cues = [];
  const cue = (text) => cues.push({ t: Date.now() / 1000, text });
  await demo(p, cue);
  await wait(p, 900);
  const tEnd = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await p.close();
  // o Chrome só manda quadro quando a tela muda: cada quadro dura até o próximo
  const list = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.001, (frames[i + 1]?.t ?? tEnd) - f.t).toFixed(3)}`).join('\n') + `\nfile '${frames.at(-1).file}'\n`;
  writeFileSync(RAW + 'list.txt', list);
  const mp4 = OUT + `demo-${name}.mp4`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', RAW + 'list.txt',
    '-vf', 'setsar=1,fps=30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4]);
  if (cues.length) await burnCaptions(x, mp4, cues.map((c, i) => ({ text: c.text, from: c.t - frames[0].t, to: (cues[i + 1]?.t ?? tEnd) - frames[0].t - 0.15 })));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-sseof', '-0.5', '-i', mp4, '-frames:v', '1', '-q:v', '4', OUT + `demo-${name}.jpg`]);
  console.log(`  ✓ demo-${name}.mp4 (${(statSync(mp4).size / 1024).toFixed(0)} KB, ${frames.length} quadros, ${(tEnd - frames[0].t).toFixed(1)} s)`);
}

/** Legendas gravadas no vídeo: cada texto vira uma imagem (fonte Inter, fundo escuro arredondado) sobreposta no tempo certo. */
async function burnCaptions(x, mp4, subs) {
  const page = await x.ctx.newPage();
  await page.setViewportSize({ width: SIZE.width, height: 140 });
  const files = [];
  for (const [i, s] of subs.entries()) {
    await page.setContent(`<html><body style="margin:0;background:transparent;display:flex;align-items:flex-end;justify-content:center;height:140px;font-family:Inter,system-ui,sans-serif">
      <div style="margin-bottom:26px;max-width:1040px;padding:14px 28px;border-radius:16px;background:rgba(10,8,24,.82);border:1px solid rgba(255,255,255,.14);color:#fff;font-size:30px;font-weight:600;line-height:1.25;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.45)">${s.text}</div></body></html>`);
    const f = `${RAW}cap${i}.png`;
    await page.screenshot({ path: f, omitBackground: true });
    files.push(f);
  }
  await page.close();
  const tmp = mp4.replace(/\.mp4$/, '.tmp.mp4');
  const inputs = files.flatMap((f) => ['-i', f]);
  let chain = '[0:v]';
  const filters = subs.map((s, i) => {
    const out = i === subs.length - 1 ? '[v]' : `[v${i}]`;
    const f = `${chain}[${i + 1}:v]overlay=0:H-h:enable='between(t,${s.from.toFixed(2)},${s.to.toFixed(2)})'${out}`;
    chain = out;
    return f;
  });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, ...inputs, '-filter_complex', filters.join(';'), '-map', '[v]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', tmp]);
  execFileSync('mv', [tmp, mp4]);
  // as mesmas legendas em .vtt, para leitores de tela e para quem quiser ativar no player
  const ts = (v) => { const ms = Math.max(0, Math.round(v * 1000)); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`; };
  writeFileSync(mp4.replace(/\.mp4$/, '.vtt'), 'WEBVTT\n\n' + subs.map((s) => `${ts(s.from)} --> ${ts(s.to)}\n${s.text}\n`).join('\n'));
}

const DEMOS = {
  // Configurações: um passeio pelas abas, com legendas.
  async configuracoes() {
    const { x } = await scene('pt', WINDOW);
    await record('configuracoes', x, async (p, cue) => {
      const tab = (t) => p.locator(`[data-tab="${t}"]`);
      const top = async () => { await p.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' })); await wait(p, 600); };
      cue('Todas as configurações num lugar só');
      await wait(p, 1600);
      await p.mouse.move(700, 500, { steps: 20 }); await p.mouse.wheel(0, 380); await wait(p, 1500); await p.mouse.wheel(0, -380); await wait(p, 600);
      cue('Plano de fundo: suas fotos, a foto do dia do Bing ou da NASA');
      await top(); await click(p, tab('fundo')); await wait(p, 2600);
      cue('IA e voz: Gemini, ChatGPT, Claude ou IA local, com a sua chave');
      await top(); await click(p, tab('ia')); await wait(p, 1200); await p.mouse.move(700, 500, { steps: 15 }); await p.mouse.wheel(0, 300); await wait(p, 2000);
      cue('Contas: sincronize entre navegadores, com criptografia');
      await top(); await click(p, tab('contas')); await wait(p, 1200); await p.mouse.move(700, 500, { steps: 15 }); await p.mouse.wheel(0, 420); await wait(p, 2200);
      cue('Backup: exporte e importe tudo quando quiser');
      await top(); await click(p, tab('backup')); await wait(p, 2600);
      cue('Grátis, sem anúncios e com código aberto');
      await top(); await click(p, tab('geral')); await wait(p, 2200);
    }, { path: 'src/options.html' });
    await x.close();
  },

  // Painel de atalhos: passar o mouse nos grupos da barra lateral.
  async atalhos() {
    const { x, data } = await scene('pt', WINDOW);
    const base = data.links;
    const groups = [['Principal', '🏠', base.slice(0, 6)], ['Trabalho', '💼', base.slice(6, 9)], ['Estudos', '📚', base.slice(8, 12)]];
    data.groups = groups.map(([name, icon], i) => ({ id: 'g' + i, name, icon }));
    data.links = groups.flatMap(([, , ls], i) => ls.map((l, j) => ({ ...l, id: `l${i}-${j}`, groupId: 'g' + i })));
    const p0 = x.ctx.pages().at(-1);
    await x.seed(p0, { nt_data: data }, { reload: false });
    await record('atalhos', x, async (p) => {
      const btns = p.locator('.rail-btn');
      await wait(p, 700);
      await glide(p, btns.nth(0)); await wait(p, 1500);
      await glide(p, '.panel a, .panel .tile', { steps: 18 }).catch(() => {}); await wait(p, 700);
      await glide(p, btns.nth(1)); await wait(p, 1400);
      await glide(p, btns.nth(2)); await wait(p, 1500);
      await p.mouse.move(SIZE.width * 0.6, SIZE.height * 0.5, { steps: 25 }); await wait(p, 1200);
    });
    await x.close();
  },

  // Voz: "me lembre amanhã às 9h…" vira lembrete.
  async voz() {
    const { x } = await scene('pt', WINDOW);
    await record('voz', x, async (p) => {
      await wait(p, 600);
      await click(p, '#voiceFab'); await wait(p, 1600);
      await p.evaluate(() => { window.__lastSR.say('me lembre amanhã às 9h de pagar a conta de luz'); window.__lastSR.stop(); });
      await wait(p, 2800);
      await p.keyboard.press('Escape');
      await wait(p, 700);
      const r = p.locator('.widget[data-id="reminders"]');
      await glide(p, r.locator(':text("conta de luz")').first()).catch(() => {});
      await wait(p, 1800);
    });
    await x.close();
  },

  // Busca universal: Ctrl+K e digitar.
  async busca() {
    const { x } = await scene('pt', { ...WINDOW, widgets: [{ id: 'brain', w: 6 }, { id: 'weather', w: 6 }] });
    await record('busca', x, async (p) => {
      await wait(p, 800);
      await p.keyboard.press('Control+k'); await wait(p, 600);
      await p.keyboard.type('sono', { delay: 180 }); await wait(p, 1800);
      await p.keyboard.press('ArrowDown'); await wait(p, 500);
      await p.keyboard.press('ArrowDown'); await wait(p, 1200);
      await p.keyboard.press('Control+a'); await p.keyboard.type('200 + 15%', { delay: 120 }); await wait(p, 2000);
      await p.keyboard.press('Escape'); await wait(p, 500);
    });
    await x.close();
  },

  // Agenda: semana, mês e um compromisso novo.
  async agenda() {
    const { x } = await scene('pt', { ...WINDOW, widgets: [{ id: 'agenda', w: 8 }, { id: 'reminders', w: 4 }] });
    const k = (d, hm) => `2026-11-${String(d).padStart(2, '0')}${hm ? 'T' + hm : ''}`;
    const ev = (id, title, d, s, e, extra = {}) => ({ id, uid: id, cal: 'local', title, location: '', notes: '', url: '', allDay: !s, tz: 'America/Sao_Paulo', start: s ? k(d, s) : k(d), end: s ? k(d, e) : k(d + 1), rrule: null, exdates: [], alarm: 10, createdAt: 1, updatedAt: 1, ...extra });
    const events = [
      ev('a', 'Reunião com a equipe', 5, '14:00', '15:00', { location: 'Google Meet' }),
      ev('b', 'Dentista', 6, '09:30', '10:30', { location: 'Clínica Sorriso' }),
      ev('c', 'Pilates', 4, '18:00', '19:00', { rrule: { freq: 'WEEKLY', interval: 1, byday: [{ wd: 3, n: 0 }, { wd: 5, n: 0 }] } }),
      ev('d', 'Aniversário da Bia', 8),
      ev('e', 'Entrega do relatório', 10, '17:00', '17:30'),
      ev('f', 'Viagem a BH', 13, null, null, { allDay: true, start: k(13), end: k(16) }),
    ];
    const cal = { calendars: [{ id: 'local', type: 'local', name: 'Minha agenda', color: '#7c6cf0', visible: true }], events };
    await x.seed(x.ctx.pages().at(-1), { nt_calendar: cal }, { reload: false });
    await record('agenda', x, async (p) => {
      const card = p.locator('.widget[data-id="agenda"]');
      await wait(p, 1000);
      await click(p, card.locator('.ag-views button:has-text("Semana")')); await wait(p, 1600);
      await click(p, card.locator('.ag-views button:has-text("Mês")')); await wait(p, 1600);
      await click(p, card.locator('button[title="Novo compromisso"]')); await wait(p, 500);
      const dlg = p.locator('dialog.ag-dlg[open]');
      await dlg.locator('input[name="title"]').pressSequentially('Consulta de retorno', { delay: 90 });
      await dlg.locator('input[type="date"]').first().fill('2026-11-12');
      await dlg.locator('input[type="date"]').nth(1).fill('2026-11-12');
      await dlg.locator('input[type="time"]').first().fill('15:00');
      await dlg.locator('input[type="time"]').nth(1).fill('15:50');
      await dlg.locator('label:has-text("Local") input').pressSequentially('Clínica Harmonize', { delay: 60 });
      await wait(p, 500);
      await click(p, dlg.locator('button[value="ok"]')); await wait(p, 1300);
      await glide(p, card.locator('.ag-ev:has-text("Consulta de retorno")')); await wait(p, 1000);
      await click(p, card.locator('.ag-views button:has-text("Próximos")')); await wait(p, 1800);
    });
    await x.close();
  },
};

const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(DEMOS);
for (const name of want) {
  console.log(name);
  rmSync(RAW, { recursive: true, force: true });
  await DEMOS[name]();
}
void NOW; void HOUR;
