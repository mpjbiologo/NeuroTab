// Gera as capturas de tela das lojas (docs/store) e do site (docs/) com o visual atual.
// Uso: node scripts/screenshots.mjs [pt|en|es …]   (sem argumentos: os três idiomas)
// Tudo é simulado: relógio fixo, clima, cotações, fundo e conteúdo de exemplo. Nada sai para a internet.
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch } from '../tests/e2e/helpers.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const STORE = ROOT + 'docs/store/';
const TMP = '/tmp/neurotab-shots/';
mkdirSync(TMP, { recursive: true });

// Quinta-feira, 5 de novembro de 2026, 08:35 (horário de Brasília).
const NOW = new Date('2026-11-05T08:35:00-03:00');
const HOUR = 3600e3;

const T = {
  pt: {
    locale: 'pt-BR', name: 'Ana', group: 'Principal',
    tasks: [['Pagar boleto da internet', -17, ['contas']], ['Reunião com a equipe', 6, ['trabalho']]],
    notes: [['App de receitas saudáveis', 'Gerar receitas a partir do que tenho na geladeira, com IA.', 'idea', ['ideias', 'apps']],
      ['Sono e produtividade', 'Pouco sono afeta a atenção tanto quanto ficar sem dormir.', 'clip', ['saúde', 'sono']],
      ['Livros para ler', 'O poder do hábito; Rápido e devagar; Pense de novo.', 'note', ['leitura']]],
    focus: 'Terminar o relatório trimestral',
    habits: [['Água', 5, 8], ['Leitura', 1, 1], ['Exercício', 0, 1]],
    said: 'me lembre amanhã às 9h de pagar a conta de luz',
    search: 'sono',
  },
  en: {
    locale: 'en', name: 'Ana', group: 'Home',
    tasks: [['Pay the internet bill', -17, ['bills']], ['Team meeting', 6, ['work']]],
    notes: [['Healthy recipes app', 'Generate recipes from what is in my fridge, with AI.', 'idea', ['ideas', 'apps']],
      ['Sleep and productivity', 'Too little sleep hurts attention as much as not sleeping at all.', 'clip', ['health', 'sleep']],
      ['Books to read', 'The Power of Habit; Thinking, Fast and Slow; Think Again.', 'note', ['reading']]],
    focus: 'Finish the quarterly report',
    habits: [['Water', 5, 8], ['Reading', 1, 1], ['Exercise', 0, 1]],
    said: 'remind me tomorrow at 9 am to pay the electricity bill',
    search: 'sleep',
  },
  es: {
    locale: 'es', name: 'Ana', group: 'Inicio',
    tasks: [['Pagar la factura de internet', -17, ['cuentas']], ['Reunión con el equipo', 6, ['trabajo']]],
    notes: [['App de recetas saludables', 'Generar recetas con lo que tengo en la nevera, con IA.', 'idea', ['ideas', 'apps']],
      ['Sueño y productividad', 'Dormir poco afecta la atención tanto como no dormir.', 'clip', ['salud', 'sueño']],
      ['Libros para leer', 'El poder de los hábitos; Pensar rápido, pensar despacio; Piensa otra vez.', 'note', ['lectura']]],
    focus: 'Terminar el informe trimestral',
    habits: [['Agua', 5, 8], ['Lectura', 1, 1], ['Ejercicio', 0, 1]],
    said: 'recuérdame mañana a las 9 pagar la factura de la luz',
    search: 'sueño',
  },
};

const LINKS = [['WhatsApp Web', 'https://web.whatsapp.com/', '#48ce70'], ['Gmail', 'https://mail.google.com/', '#e5e4e2'],
  ['Google Drive', 'https://drive.google.com/', '#2f86d6'], ['YouTube', 'https://www.youtube.com/', '#f4473b'],
  ['Spotify', 'https://open.spotify.com/', '#26f0a0'], ['Google Agenda', 'https://calendar.google.com/', '#5a8ff0'],
  ['Notion', 'https://www.notion.so/', '#e5e4e2'], ['GitHub', 'https://github.com/', '#2d2d2d'],
  ['Wikipedia', 'https://www.wikipedia.org/', '#e5e4e2'], ['SciELO', 'https://www.scielo.br/', '#c3161c'],
  ['Netflix', 'https://www.netflix.com/', '#c2234a'], ['NeuroTab', 'https://github.com/mpjbiologo/NeuroTab', '#7a4e93']];

const PLACES = [
  { id: 'bh', name: 'Belo Horizonte', region: 'Minas Gerais', lat: -19.92, lon: -43.94, tz: 'America/Sao_Paulo' },
  { id: 'lis', name: 'Lisboa', region: 'Lisboa', lat: 38.72, lon: -9.13, tz: 'Europe/Lisbon' },
  { id: 'tyo', name: 'Tóquio', region: 'Tóquio', lat: 35.68, lon: 139.69, tz: 'Asia/Tokyo' },
];

const CITY = { pt: {}, en: { lis: 'Lisbon', tyo: 'Tokyo' }, es: { tyo: 'Tokio' } };

const CORS = { 'access-control-allow-origin': '*' };
const days = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'];
const weather = (lat) => {
  const t = lat < 0 ? 26 : lat > 37 ? 17 : 13;
  return {
    timezone: lat < 0 ? 'America/Sao_Paulo' : lat > 37 ? 'Europe/Lisbon' : 'Asia/Tokyo',
    current: { temperature_2m: t, apparent_temperature: t + 1, weather_code: lat < 0 ? 2 : 3, relative_humidity_2m: 55, wind_speed_10m: 8, is_day: 1 },
    daily: { time: days, weather_code: [2, 61, 3, 0, 1], temperature_2m_max: [28, 25, 27, 31, 30], temperature_2m_min: [17, 17, 18, 19, 18], precipitation_probability_max: [10, 80, 30, 5, 10] },
  };
};
const QUOTES = {
  USDBRL: { code: 'USD', codein: 'BRL', name: 'Dólar Americano/Real Brasileiro', bid: '5.42', pctChange: '-0.35' },
  EURBRL: { code: 'EUR', codein: 'BRL', name: 'Euro/Real Brasileiro', bid: '6.21', pctChange: '0.12' },
  BTCBRL: { code: 'BTC', codein: 'BRL', name: 'Bitcoin/Real Brasileiro', bid: '612000', pctChange: '1.80' },
};

// Fundo abstrato (gerado na hora, sem foto de terceiros).
const BACKGROUND = () => {
  const c = document.createElement('canvas');
  c.width = 1920; c.height = 1200;
  const g = c.getContext('2d');
  g.fillStyle = '#0d0b1f'; g.fillRect(0, 0, 1920, 1200);
  const blob = (x, y, r, col) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 1920, 1200); };
  blob(300, 250, 900, 'rgba(60,70,190,.85)');
  blob(1650, 300, 800, 'rgba(150,50,170,.75)');
  blob(1100, 1100, 900, 'rgba(20,140,150,.55)');
  blob(200, 1150, 700, 'rgba(110,40,140,.6)');
  return c.toDataURL('image/jpeg', 0.92);
};

async function scene(lang) {
  const L = T[lang];
  const x = await launch({ locale: L.locale, viewport: { width: 1280, height: 800 }, voice: true });
  await x.ctx.addInitScript(() => {
    if (globalThis.chrome?.permissions) chrome.permissions.contains = async () => true;
  });
  await x.ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ json: weather(+new URL(r.request().url()).searchParams.get('latitude')), headers: CORS }));
  await x.ctx.route('https://economia.awesomeapi.com.br/**', (r) => r.fulfill({ json: QUOTES, headers: CORS }));
  await x.ctx.clock.setFixedTime(NOW);

  const p = await x.open('src/newtab.html');
  const t0 = NOW.getTime();
  const item = (o, i) => ({ id: 'i' + i, type: o.type, title: o.title, text: o.text || '', url: '', pageTitle: '', tags: o.tags, summary: '', pinned: !!o.pinned,
    done: false, remindAt: o.remindAt || null, notifiedAt: null, source: 'manual', createdAt: t0 - (i + 1) * 2 * HOUR, updatedAt: t0 - (i + 1) * 2 * HOUR, enriched: true });
  const brain = [
    ...L.notes.map(([title, text, type, tags], i) => ({ title, text, type, tags, pinned: i === 0 })),
    ...L.tasks.map(([title, h, tags]) => ({ title, type: 'task', tags, remindAt: t0 + h * HOUR })),
  ].map(item);
  const data = await x.storage(p, 'nt_data');
  const gid = data.groups[0].id;
  data.groups = [{ id: gid, name: L.group, icon: '🏠' }];
  data.links = LINKS.map(([title, url, color], i) => ({ id: 'l' + i, groupId: gid, title, url, color, favicon: '' }));
  Object.assign(data.settings, {
    lang: L.locale, userName: L.name, places: PLACES.map((c) => ({ ...c, name: CITY[lang][c.id] || c.name })), heroWeather: true, heroPlaces: true, theme: 'futurista', bgDim: 10, checkUpdates: false,
    widgets: [{ id: 'capture', w: 6 }, { id: 'reminders', w: 6 }, { id: 'focus', w: 4 }, { id: 'habits', w: 4 }, { id: 'quotes', w: 4 }],
  });
  const ids = ['agua', 'leitura', 'exercicio'];
  await x.seed(p, {
    nt_data: data,
    nt_brain: brain,
    nt_bg: await p.evaluate(BACKGROUND),
    nt_focus: { date: NOW.toDateString(), text: L.focus, done: false },
    nt_habits: {
      habits: L.habits.map(([name, , target], i) => ({ id: ids[i], name, icon: ['💧', '📖', '🏃'][i], target })),
      log: { '2026-11-05': Object.fromEntries(L.habits.map(([, n], i) => [ids[i], n])), '2026-11-04': { agua: 8, leitura: 1, exercicio: 1 }, '2026-11-03': { agua: 8, leitura: 1 } },
    },
  }, { reload: false });
  await reopen(p);
  return { x, p, L, data, brain };
}

// A página recarrega sozinha quando o idioma muda; abrir de novo evita a corrida.
async function reopen(p) {
  await p.waitForTimeout(600);
  await p.goto(p.url());
  await p.waitForTimeout(1800);
}

async function shot(p, file, { w, h, quality } = {}) {
  const raw = TMP + file.replace(/\.\w+$/, '.png');
  await p.screenshot({ path: raw });
  const out = file.startsWith('/') ? file : ROOT + file;
  const args = [raw];
  if (w) args.push('-resize', `${w}x${h}!`);
  if (out.endsWith('.png')) args.push('-alpha', 'off', 'PNG24:' + out);
  else args.push('-quality', String(quality || 86), out);
  execFileSync('convert', args);
  console.log('  ✓', file);
}

const closeOverlays = (p) => p.keyboard.press('Escape').then(() => p.waitForTimeout(300));

async function run(lang) {
  console.log(lang);
  const { x, p, L, data, brain } = await scene(lang);
  const site = lang === 'pt';

  // 1) Início
  await shot(p, `docs/store/screenshot-1-${lang}.png`);
  if (site) { await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(700); await shot(p, 'docs/shot-home.jpg'); }

  // 2) Painel de atalhos
  await p.evaluate(async () => (await import('/src/newtab/rail.js')).openPanel(null, true));
  await p.waitForTimeout(700);
  if (site) await shot(p, 'docs/shot-panel.jpg');
  await p.setViewportSize({ width: 1280, height: 800 }); await p.waitForTimeout(500);
  await shot(p, `docs/store/screenshot-2-${lang}.png`);
  await closeOverlays(p);
  await p.mouse.click(640, 30); await p.waitForTimeout(400);

  // 3) Voz
  await p.click('#voiceFab');
  await p.waitForTimeout(400);
  await p.evaluate((t) => { window.__lastSR.say(t); window.__lastSR.stop(); }, L.said);
  await p.waitForTimeout(1500);
  await shot(p, `docs/store/screenshot-3-${lang}.png`);
  if (site) { await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(500); await shot(p, 'docs/shot-voice.jpg'); await p.setViewportSize({ width: 1280, height: 800 }); }
  await p.click('#voiceClose').catch(() => {});
  await p.waitForTimeout(300);

  if (site) {
    // 4) Cérebro, relógio (Pomodoro) e calculadora
    data.settings.widgets = [{ id: 'brain', w: 6 }, { id: 'clock', w: 3 }, { id: 'calc', w: 3 }, { id: 'reminders', w: 6 }];
    await x.seed(p, { nt_data: data, nt_brain: brain }, { reload: false });
    await reopen(p);
    await p.getByRole('button', { name: /Pomodoro/ }).first().click().catch(() => {});
    { const c = p.getByPlaceholder(/200 \+ 10%/); await c.click().catch(() => {}); await c.pressSequentially('200 + 15%', { delay: 30 }).catch(() => {}); await c.press('Enter').catch(() => {}); }
    await p.waitForTimeout(800);
    await shot(p, 'docs/store/screenshot-4-pt.png');

    // 5) Busca no cérebro
    data.settings.widgets = [{ id: 'brain', w: 6 }, { id: 'weather', w: 6 }];
    await x.seed(p, { nt_data: data }, { reload: false });
    await reopen(p);
    await p.click('#omni');
    await p.keyboard.type(L.search, { delay: 40 });
    await p.waitForTimeout(900);
    await shot(p, 'docs/store/screenshot-5-pt.png');
    await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(700);
    await shot(p, 'docs/shot-search.jpg');

    // Configurações
    const o = await x.open('src/options.html');
    await o.setViewportSize({ width: 1500, height: 1018 });
    await o.waitForTimeout(800);
    await shot(o, 'docs/screenshot-config.jpg');
  }
  if (x.errors.length) console.warn('  erros de página:', x.errors);
  await x.close();
}

const langs = process.argv.slice(2).length ? process.argv.slice(2) : ['pt', 'en', 'es'];
for (const l of langs) await run(l);
writeFileSync(TMP + '.ok', new Date().toISOString());
