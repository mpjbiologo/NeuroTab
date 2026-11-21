// Widget: "Como foi hoje?" (#58) — humor, energia e uma frase por dia, com histórico.
// Privado por padrão: fica só neste computador, não sincroniza e não vai para a IA (sem brainContext).
// Nada de notificações, metas ou sequências: preencher é opcional.
import { h } from '../lib/ui.js';
import { LOCALE } from '../lib/i18n.js';
import { MOOD_KEY, MOODS, ENERGY, NOTE_MAX, dayKey, parseDay, sanitize, setEntry, deleteEntry, series, summary, toCSV, monthGrid } from '../lib/mood.js';

const fmtDay = (k, opts) => parseDay(k).toLocaleDateString(LOCALE, opts);

export default {
  id: 'mood',
  title: 'Como foi hoje?',
  icon: '🌤️',
  description: 'Registre em segundos seu humor, sua energia e uma frase do dia, e veja como eles variam. Fica só neste computador.',
  defaultW: 4,
  mount(el, ctx) {
    let st = sanitize(null);
    let day = dayKey();
    let followToday = true; // o dia em edição acompanha a data (vira à meia-noite)
    let view = 'today';
    let range = 30;
    const cal = new Date(); cal.setDate(1);
    const body = h('div', { class: 'mood' });
    const histBtn = h('button', { title: 'Histórico', 'aria-pressed': 'false', onclick: () => { view = view === 'today' ? 'history' : 'today'; render(); } }, '📅');
    ctx.actions.append(histBtn);
    el.append(body);

    const persist = async (next) => { st = next; await chrome.storage.local.set({ [MOOD_KEY]: st }); };
    const entry = () => st.days[day] || { mood: null, energy: null, note: '' };
    const syncToday = () => { if (followToday && day !== dayKey()) { day = dayKey(); render(); } };

    function render() {
      histBtn.setAttribute('aria-pressed', String(view === 'history'));
      histBtn.classList.toggle('sel', view === 'history');
      body.replaceChildren(...(view === 'history' ? historyView() : todayView()));
    }

    // ---------- registro do dia ----------
    function todayView() {
      const e = entry();
      const isToday = day === dayKey();
      const when = isToday
        ? h('p', { class: 'mood-when' }, 'Hoje · ', fmtDay(day, { weekday: 'long', day: 'numeric', month: 'long' }))
        : h('p', { class: 'mood-when past' }, 'Editando ', fmtDay(day, { weekday: 'short', day: 'numeric', month: 'short' }), ' · ',
          h('button', { class: 'linkish', type: 'button', onclick: () => { followToday = true; day = dayKey(); render(); } }, 'voltar para hoje'));

      const moods = h('div', { class: 'mood-scale', role: 'radiogroup', 'aria-label': 'Humor' }, ...MOODS.map((m) =>
        h('button', { type: 'button', role: 'radio', class: 'mood-face', title: m.label, 'aria-label': m.label, 'aria-checked': String(e.mood === m.v), 'data-emoji': '1',
          onclick: () => save({ mood: e.mood === m.v ? null : m.v }) }, m.emoji)));
      const energy = h('div', { class: 'mood-energy', role: 'radiogroup', 'aria-label': 'Energia' }, ...ENERGY.map((x) =>
        h('button', { type: 'button', role: 'radio', class: 'mood-bar' + (e.energy && x.v <= e.energy ? ' fill' : ''), title: x.label, 'aria-label': x.label, 'aria-checked': String(e.energy === x.v),
          onclick: () => save({ energy: e.energy === x.v ? null : x.v }) }, h('i'))));
      const energyLbl = h('span', { class: 'mood-elbl' }, e.energy ? ENERGY[e.energy - 1].label : '');

      const status = h('span', { class: 'mood-status', role: 'status' }, st.days[day] ? '✓ Registrado' : '');
      const note = h('input', { type: 'text', class: 'mood-note', maxlength: NOTE_MAX, value: e.note || '', placeholder: 'Uma frase sobre o dia (opcional)', 'aria-label': 'Frase sobre o dia' });
      let t;
      const saveNote = async () => {
        clearTimeout(t);
        if ((entry().note || '') === note.value.trim()) return;
        await persist(setEntry(st, day, { note: note.value }));
        status.textContent = st.days[day] ? '✓ Registrado' : '';
        clearBtn.hidden = !st.days[day];
      };
      note.addEventListener('input', () => { clearTimeout(t); t = setTimeout(saveNote, 700); });
      note.addEventListener('change', saveNote);
      note.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); saveNote(); note.blur(); } });

      const clearBtn = h('button', { type: 'button', class: 'linkish', hidden: !st.days[day], onclick: async () => {
        const before = st.days[day];
        await persist(deleteEntry(st, day));
        render();
        ctx.toast('Registro do dia apagado', 'Desfazer', async () => { await persist(setEntry(st, day, before, before.at)); render(); });
      } }, 'Apagar este dia');

      return [
        when,
        h('div', { class: 'mood-row' }, h('span', { class: 'mood-lbl' }, 'Humor'), moods),
        h('div', { class: 'mood-row' }, h('span', { class: 'mood-lbl' }, 'Energia'), energy, energyLbl),
        note,
        h('div', { class: 'mood-foot' }, status, clearBtn, h('span', { class: 'mood-priv', title: 'Não sincroniza e não vai para a IA.' }, '🔒 Só neste computador')),
      ];
    }

    async function save(patch) {
      await persist(setEntry(st, day, patch));
      render();
    }

    // ---------- histórico ----------
    function historyView() {
      const list = series(st, range);
      const sum = summary(list);
      const chips = h('div', { class: 'toolbar mood-range' }, ...[7, 30, 90].map((n) =>
        h('button', { type: 'button', class: 'chip' + (n === range ? ' sel' : ''), 'aria-pressed': String(n === range), onclick: () => { range = n; render(); } }, `${n} dias`)));
      const fmt = (v) => (v == null ? '—' : v.toLocaleString(LOCALE, { minimumFractionDigits: 1 }));
      const stats = h('p', { class: 'mood-sum' }, sum.days
        ? `${sum.days} ${sum.days === 1 ? 'dia registrado' : 'dias registrados'} · humor médio ${fmt(sum.mood)} · energia média ${fmt(sum.energy)} (de 1 a 5)`
        : 'Nenhum registro neste período.');
      return [chips, chart(list), stats, calendar(),
        h('div', { class: 'toolbar mood-data' },
          h('button', { type: 'button', class: 'chip', onclick: exportCSV, disabled: !Object.keys(st.days).length }, '⬇ Exportar planilha'),
          h('button', { type: 'button', class: 'chip danger', onclick: eraseAll, disabled: !Object.keys(st.days).length }, '🗑 Apagar tudo')),
        h('p', { class: 'mood-priv small' }, '🔒 Os registros ficam só neste computador: não sincronizam e nunca vão para a IA. Isto não é uma avaliação de saúde.')];
    }

    function chart(list) {
      const W = 300; const H = 84; const P = 6;
      const x = (i) => P + (list.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (list.length - 1));
      const y = (v) => H - P - ((v - 1) * (H - 2 * P)) / 4;
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.setAttribute('class', 'mood-chart');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', `Humor e energia nos últimos ${range} dias`);
      for (let lv = 1; lv <= 5; lv++) {
        const g = document.createElementNS(ns, 'line');
        Object.entries({ x1: P, x2: W - P, y1: y(lv), y2: y(lv), class: 'grid-l' }).forEach(([k, v]) => g.setAttribute(k, v));
        svg.append(g);
      }
      for (const [key, cls] of [['energy', 'l-energy'], ['mood', 'l-mood']]) {
        let seg = [];
        const flush = () => {
          if (seg.length > 1) { const pl = document.createElementNS(ns, 'polyline'); pl.setAttribute('points', seg.join(' ')); pl.setAttribute('class', cls); svg.append(pl); }
          seg = [];
        };
        list.forEach((d, i) => {
          if (!d[key]) { flush(); return; }
          seg.push(`${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`);
          if (range <= 30) {
            const c = document.createElementNS(ns, 'circle');
            Object.entries({ cx: x(i).toFixed(1), cy: y(d[key]).toFixed(1), r: 2.4, class: cls }).forEach(([k, v]) => c.setAttribute(k, v));
            const tt = document.createElementNS(ns, 'title');
            tt.textContent = `${fmtDay(d.day, { day: 'numeric', month: 'short' })}: ${key === 'mood' ? 'humor' : 'energia'} ${d[key]}`;
            c.append(tt);
            svg.append(c);
          }
        });
        flush();
      }
      return h('figure', { class: 'mood-fig' }, svg,
        h('figcaption', { class: 'mood-legend' }, h('span', { class: 'k-mood' }, 'Humor'), h('span', { class: 'k-energy' }, 'Energia')));
    }

    function calendar() {
      const today = dayKey();
      const y = cal.getFullYear(); const m = cal.getMonth();
      const cells = monthGrid(y, m).map((k) => {
        if (!k) return h('span', { class: 'mc empty' });
        const e = st.days[k];
        const future = k > today;
        const face = e?.mood ? MOODS[e.mood - 1].emoji : e ? '•' : '';
        return h('button', { type: 'button', class: 'mc' + (k === today ? ' today' : '') + (k === day && view === 'history' ? ' cur' : '') + (e ? ' has' : ''), disabled: future,
          title: fmtDay(k, { weekday: 'long', day: 'numeric', month: 'long' }) + (e?.note ? ` — ${e.note}` : ''),
          onclick: () => { day = k; followToday = k === today; view = 'today'; render(); } },
        h('span', { class: 'mc-n' }, String(parseDay(k).getDate())), h('span', { class: 'mc-f', 'data-emoji': '1' }, face));
      });
      const nav = (d) => { cal.setMonth(cal.getMonth() + d); render(); };
      const isNow = y === new Date().getFullYear() && m === new Date().getMonth();
      return h('div', { class: 'mood-cal' },
        h('div', { class: 'mc-head' },
          h('button', { type: 'button', class: 'chip', title: 'Mês anterior', onclick: () => nav(-1) }, '‹'),
          h('b', {}, ((x) => x[0].toUpperCase() + x.slice(1))(new Date(y, m, 1).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' }))),
          h('button', { type: 'button', class: 'chip', title: 'Próximo mês', disabled: isNow, onclick: () => nav(1) }, '›')),
        h('div', { class: 'mc-grid' }, ...[0, 1, 2, 3, 4, 5, 6].map((i) => h('span', { class: 'mc-wd', 'aria-hidden': 'true' }, new Date(2026, 10, 1 + i).toLocaleDateString(LOCALE, { weekday: 'narrow' }).toUpperCase())), ...cells));
    }

    function exportCSV() {
      const blob = new Blob([toCSV(st)], { type: 'text/csv;charset=utf-8' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `neurotab-como-foi-hoje-${dayKey()}.csv` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }

    async function eraseAll() {
      const n = Object.keys(st.days).length;
      if (!confirm(`Apagar os ${n} registros de "Como foi hoje?"? Não dá para desfazer depois de fechar o aviso.`)) return;
      const before = st;
      await persist(sanitize(null));
      render();
      ctx.toast('Registros apagados', 'Desfazer', async () => { await persist(before); render(); });
    }

    const onChange = (c, area) => { if (area === 'local' && c[MOOD_KEY]) { st = sanitize(c[MOOD_KEY].newValue); if (!body.contains(document.activeElement)) render(); } };
    chrome.storage.onChanged.addListener(onChange);
    const onVis = () => { if (!document.hidden) syncToday(); };
    document.addEventListener('visibilitychange', onVis);
    const tick = setInterval(syncToday, 60e3);
    chrome.storage.local.get(MOOD_KEY).then((r) => { st = sanitize(r[MOOD_KEY]); render(); });
    render();
    return { destroy: () => { chrome.storage.onChanged.removeListener(onChange); document.removeEventListener('visibilitychange', onVis); clearInterval(tick); } };
  },
};
