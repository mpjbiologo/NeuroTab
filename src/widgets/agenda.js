// Widget: Agenda (#26) — próximos, dia, semana e mês; eventos locais e agendas por link (.ics).
import { h } from '../lib/ui.js';
import { requestAccess } from '../lib/permissions.js';
import {
  loadCalendar, eventsBetween, saveEvent, deleteEvent, refreshFeeds, addFeed, removeCalendar, updateCalendarMeta,
  importICS, normalizeFeedUrl, CAL_KEY, CAL_CACHE_KEY, LOCAL_CAL, COLORS, REFRESH_MIN, keyPlus, tsToKey,
} from '../lib/calendar.js';
import { toICS } from '../lib/ics.js';
import { LOCAL_TZ, todayYmd, addDays, parseYmd, dayStart, weekday, daysInMonth, ymd, pad } from '../lib/tz.js';
import { t, LANG } from '../lib/i18n.js';

const VIEWS = [['list', 'Próximos'], ['day', 'Dia'], ['week', 'Semana'], ['month', 'Mês']];
const REPEATS = [['', 'Não repete'], ['DAILY', 'Todo dia'], ['WEEKDAYS', 'Dias úteis (seg. a sex.)'], ['WEEKLY', 'Toda semana'], ['MONTHLY', 'Todo mês'], ['YEARLY', 'Todo ano']];
const ALARMS = [['', 'Sem aviso'], ['0', 'Na hora'], ['5', '5 min antes'], ['10', '10 min antes'], ['15', '15 min antes'], ['30', '30 min antes'], ['60', '1 hora antes'], ['1440', '1 dia antes']];

const loc = () => (LANG && LANG !== 'auto' ? LANG : undefined);
const fmtTime = (ts) => new Date(ts).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' });
const cap = (x) => (x ? x[0].toLocaleUpperCase() + x.slice(1) : x);
const fmtDay = (s, o = { weekday: 'long', day: 'numeric', month: 'long' }) => cap(new Date(dayStart(s)).toLocaleDateString(loc(), o));
const occDay = (o) => todayYmd(o.start);

function repeatOf(ev) {
  const r = ev.rrule;
  if (!r) return '';
  if (r.freq === 'WEEKLY' && r.byday?.length === 5 && [1, 2, 3, 4, 5].every((d) => r.byday.some((b) => b.wd === d))) return 'WEEKDAYS';
  return r.freq;
}
function ruleFor(rep, startDate) {
  if (!rep) return null;
  if (rep === 'WEEKDAYS') return { freq: 'WEEKLY', interval: 1, byday: [1, 2, 3, 4, 5].map((wd) => ({ wd, n: 0 })) };
  if (rep === 'WEEKLY') return { freq: 'WEEKLY', interval: 1, byday: [{ wd: weekday(startDate), n: 0 }] };
  return { freq: rep, interval: 1 };
}

export default {
  id: 'agenda',
  title: 'Agenda',
  icon: '📅',
  description: 'Seus compromissos: agenda própria e agendas do Google, Outlook e iCloud por link.',
  defaultW: 6,
  mount(el, ctx) {
    let view = ctx.widget.view || 'list';
    let anchor = todayYmd();
    let cal = null;

    // ---------- Barra ----------
    const title = h('b', { class: 'ag-title' });
    const seg = h('div', { class: 'seg ag-views' }, ...VIEWS.map(([v, label]) => h('button', { class: 'btn', type: 'button', 'data-v': v, onclick: () => { view = v; ctx.saveWidget({ view }); render(); } }, label)));
    const nav = h('div', { class: 'ag-nav' },
      h('button', { class: 'btn', type: 'button', title: 'Anterior', onclick: () => move(-1) }, '‹'),
      h('button', { class: 'btn', type: 'button', onclick: () => { anchor = todayYmd(); render(); } }, 'Hoje'),
      h('button', { class: 'btn', type: 'button', title: 'Próximo', onclick: () => move(1) }, '›'),
      title);
    const body = h('div', { class: 'ag-body' });
    const status = h('p', { class: 'ag-status muted', role: 'status' });
    ctx.actions.append(
      h('button', { title: 'Agendas, links do Google/Outlook/iCloud e importar .ics', onclick: () => manage() }, '⚙️'),
      h('button', { title: 'Novo compromisso', onclick: () => edit(null, { date: anchor }) }, '＋'),
    );
    el.append(h('div', { class: 'ag-bar' }, nav, seg), body, status);

    function move(dir) {
      if (view === 'day') anchor = addDays(anchor, dir);
      else if (view === 'week' || view === 'list') anchor = addDays(anchor, dir * 7);
      else { const { y, m } = parseYmd(anchor); const t2 = new Date(Date.UTC(y, m - 1 + dir, 1)); anchor = ymd(t2.getUTCFullYear(), t2.getUTCMonth() + 1, 1); }
      render();
    }

    // ---------- Itens ----------
    const chip = (o, { time = true } = {}) => h('button', {
      class: 'ag-ev' + (o.calendar.id === LOCAL_CAL ? '' : ' ext'), type: 'button', style: `--c:${o.calendar.color || COLORS[0]}`,
      title: [o.ev.title, o.ev.location, o.calendar.name].filter(Boolean).join(' · '),
      onclick: () => open(o),
    },
    time ? h('span', { class: 'ag-time' }, o.allDay ? t('dia todo') : fmtTime(o.start)) : null,
    h('span', { class: 'ag-name' }, o.ev.title),
    o.ev.location && time ? h('span', { class: 'ag-loc' }, o.ev.location) : null);

    const dayBlock = (d, list, { head = true } = {}) => h('div', { class: 'ag-day' + (d === todayYmd() ? ' today' : '') },
      head ? h('div', { class: 'ag-dayhead' }, d === todayYmd() ? t('Hoje') : d === addDays(todayYmd(), 1) ? t('Amanhã') : fmtDay(d)) : null,
      ...(list.length ? list.map((o) => chip(o)) : [h('p', { class: 'muted ag-free' }, 'Livre')]));

    function byDay(occ, from, days) {
      const map = new Map();
      for (let i = 0; i < days; i++) map.set(addDays(from, i), []);
      for (const o of occ) {
        // evento de vários dias aparece em cada dia que ocupa
        let d = occDay(o);
        const last = todayYmd(o.end - 1);
        for (let i = 0; i < 62 && d <= last; i++, d = addDays(d, 1)) if (map.has(d)) map.get(d).push(o);
      }
      return map;
    }

    function render() {
      if (!cal) return;
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.v === view));
      el.dataset.view = view;
      body.replaceChildren();
      if (view === 'list') {
        const from = anchor;
        const occ = eventsBetween(cal, dayStart(from), dayStart(addDays(from, 14))).filter((o) => o.end > Date.now() || from !== todayYmd());
        title.textContent = from === todayYmd() ? t('Próximos 14 dias') : `${fmtDay(from, { day: 'numeric', month: 'short' })} – ${fmtDay(addDays(from, 13), { day: 'numeric', month: 'short' })}`;
        const map = byDay(occ, from, 14);
        const days = [...map].filter(([, l]) => l.length);
        if (!days.length) body.append(h('p', { class: 'empty' }, '📅 Nada marcado nos próximos dias. Toque em ＋ para criar, ou em ⚙️ para trazer o Google Agenda.'));
        for (const [d, l] of days) body.append(dayBlock(d, l));
      } else if (view === 'day') {
        title.textContent = fmtDay(anchor);
        const occ = eventsBetween(cal, dayStart(anchor), dayStart(addDays(anchor, 1)));
        body.append(dayBlock(anchor, occ, { head: false }));
      } else if (view === 'week') {
        const from = addDays(anchor, -weekday(anchor));
        title.textContent = `${fmtDay(from, { day: 'numeric', month: 'short' })} – ${fmtDay(addDays(from, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`;
        const map = byDay(eventsBetween(cal, dayStart(from), dayStart(addDays(from, 7))), from, 7);
        body.append(h('div', { class: 'ag-week' }, ...[...map].map(([d, l]) => h('div', { class: 'ag-col' + (d === todayYmd() ? ' today' : '') },
          h('button', { class: 'ag-colhead', type: 'button', onclick: () => { anchor = d; view = 'day'; render(); } }, fmtDay(d, { weekday: 'short', day: 'numeric' })),
          ...l.map((o) => chip(o))))));
      } else {
        const { y, m } = parseYmd(anchor);
        const first = ymd(y, m, 1);
        const from = addDays(first, -weekday(first));
        const weeks = Math.ceil((weekday(first) + daysInMonth(y, m)) / 7);
        title.textContent = cap(new Date(dayStart(first)).toLocaleDateString(loc(), { month: 'long', year: 'numeric' }));
        const map = byDay(eventsBetween(cal, dayStart(from), dayStart(addDays(from, weeks * 7))), from, weeks * 7);
        const names = [...Array(7)].map((_, i) => fmtDay(addDays(from, i), { weekday: 'narrow' }));
        body.append(h('div', { class: 'ag-month' },
          ...names.map((n) => h('div', { class: 'ag-wd' }, n)),
          ...[...map].map(([d, l]) => h('div', { class: 'ag-cell' + (d === todayYmd() ? ' today' : '') + (parseYmd(d).m !== m ? ' out' : '') },
            h('button', { class: 'ag-num', type: 'button', title: fmtDay(d), onclick: () => { anchor = d; view = 'day'; render(); } }, String(parseYmd(d).d)),
            ...l.slice(0, 3).map((o) => chip(o, { time: false })),
            l.length > 3 ? h('button', { class: 'ag-more', type: 'button', onclick: () => { anchor = d; view = 'day'; render(); } }, `+${l.length - 3}`) : null))));
      }
      const errs = cal.calendars.filter((c) => c.type === 'ics' && c.error && c.visible !== false);
      status.textContent = errs.length ? `⚠️ ${errs.map((c) => `${c.name}: ${t(c.error)}`).join(' · ')}` : '';
    }

    // ---------- Diálogos ----------
    function dialog(content, { wide = false } = {}) {
      const dlg = h('dialog', { class: 'dlg ag-dlg' + (wide ? ' dlg-wide' : '') }, content);
      document.body.append(dlg);
      dlg.addEventListener('close', () => dlg.remove());
      dlg.showModal();
      return dlg;
    }

    function open(o) {
      if (o.calendar.id === LOCAL_CAL) return edit(o.ev, { occurrence: o.ev.rrule ? o.key : null });
      const when = o.allDay ? `${fmtDay(occDay(o))} · ${t('dia todo')}` : `${fmtDay(occDay(o))} · ${fmtTime(o.start)}–${fmtTime(o.end)}`;
      const dlg = dialog(h('form', { method: 'dialog' },
        h('h2', {}, o.ev.title),
        h('p', { class: 'ag-when' }, when),
        o.ev.location ? h('p', {}, '📍 ', o.ev.location) : null,
        o.ev.notes ? h('p', { class: 'ag-notes' }, o.ev.notes) : null,
        h('p', { class: 'muted' }, `${t('Agenda')}: ${o.calendar.name} · ${t('só leitura (vem de um link)')}`),
        h('div', { class: 'actions' },
          o.ev.url ? h('a', { class: 'btn', href: o.ev.url, target: '_blank', rel: 'noopener noreferrer' }, '↗ Abrir no serviço') : null,
          h('button', { class: 'btn', type: 'button', onclick: () => { dlg.close(); edit({ ...o.ev, id: null, uid: null, rrule: null, exdates: [], overrides: undefined, start: tsToKey(o.start), end: tsToKey(o.end), allDay: o.allDay, ...(o.allDay ? { start: occDay(o), end: todayYmd(o.end - 1) === occDay(o) ? addDays(occDay(o), 1) : todayYmd(o.end) } : {}) }); } }, '📋 Copiar para minha agenda'),
          h('button', { class: 'btn primary', value: 'ok' }, 'Fechar'))));
    }

    function edit(ev, { date, occurrence } = {}) {
      const isNew = !ev?.id;
      const start0 = ev?.start || `${date || todayYmd()}T${pad(Math.min(23, new Date().getHours() + 1))}:00`;
      const f = {
        title: h('input', { name: 'title', required: true, placeholder: 'Ex.: Dentista', value: ev?.title || '' }),
        allDay: h('input', { type: 'checkbox', checked: !!ev?.allDay }),
        sd: h('input', { type: 'date', required: true, value: start0.slice(0, 10) }),
        st: h('input', { type: 'time', value: start0.slice(11, 16) || '09:00' }),
        ed: h('input', { type: 'date', value: ev ? (ev.allDay ? addDays(ev.end, -1) : ev.end.slice(0, 10)) : start0.slice(0, 10) }),
        et: h('input', { type: 'time', value: ev && !ev.allDay ? ev.end.slice(11, 16) : keyPlus(start0.length > 10 ? start0 : start0 + 'T09:00', 60).slice(11, 16) }),
        rep: h('select', {}, ...REPEATS.map(([v, l]) => h('option', { value: v }, l))),
        alarm: h('select', {}, ...ALARMS.map(([v, l]) => h('option', { value: v }, l))),
        location: h('input', { placeholder: 'Opcional', value: ev?.location || '' }),
        notes: h('textarea', { rows: 3, placeholder: 'Opcional' }, ev?.notes || ''),
      };
      f.rep.value = ev ? repeatOf(ev) : '';
      f.alarm.value = ev ? (ev.alarm == null ? '' : String(ev.alarm)) : '10';
      const sync = () => { f.st.hidden = f.et.hidden = f.allDay.checked; };
      f.allDay.addEventListener('change', sync);
      f.sd.addEventListener('change', () => { if (!f.ed.value || f.ed.value < f.sd.value) f.ed.value = f.sd.value; });
      sync();
      const del = !isNew && h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if (occurrence && ev.rrule) {
          const all = confirm(t('Excluir todas as repetições? (Cancelar = só esta)'));
          await deleteEvent(ev.id, all ? {} : { occurrence });
        } else {
          if (!confirm(t('Excluir este compromisso?'))) return;
          await deleteEvent(ev.id);
        }
        dlg.close();
        ctx.toast('Compromisso excluído');
      } }, '🗑 Excluir');
      const form = h('form', { method: 'dialog' },
        h('h2', {}, isNew ? 'Novo compromisso' : 'Editar compromisso'),
        h('label', {}, 'Título', f.title),
        h('label', { class: 'check' }, f.allDay, ' ', 'Dia inteiro'),
        h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Início', h('div', { class: 'row' }, f.sd, f.st))),
        h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Fim', h('div', { class: 'row' }, f.ed, f.et))),
        h('div', { class: 'row' }, h('label', { class: 'grow' }, 'Repetir', f.rep), h('label', { class: 'grow' }, 'Aviso', f.alarm)),
        h('label', {}, 'Local', f.location),
        h('label', {}, 'Notas', f.notes),
        ev?.rrule && occurrence ? h('p', { class: 'muted' }, 'Mudanças aqui valem para todas as repetições.') : null,
        h('div', { class: 'actions' }, del || null, h('button', { class: 'btn', value: 'cancel', formnovalidate: true }, 'Cancelar'), h('button', { class: 'btn primary', value: 'ok' }, 'Salvar')));
      form.addEventListener('submit', async (e) => {
        if (e.submitter?.value !== 'ok') return;
        const allDay = f.allDay.checked;
        const start = allDay ? f.sd.value : `${f.sd.value}T${f.st.value || '09:00'}`;
        const endDate = f.ed.value || f.sd.value;
        const end = allDay ? addDays(endDate < f.sd.value ? f.sd.value : endDate, 1) : `${endDate}T${f.et.value || f.st.value || '10:00'}`;
        const keepRule = ev?.rrule && repeatOf(ev) === f.rep.value;
        await saveEvent({
          ...(ev || {}), title: f.title.value, allDay, start, end, tz: ev?.tz || LOCAL_TZ,
          rrule: keepRule ? ev.rrule : ruleFor(f.rep.value, f.sd.value), exdates: keepRule ? ev.exdates : [],
          alarm: f.alarm.value, location: f.location.value, notes: f.notes.value,
        });
        ctx.toast(isNew ? 'Compromisso criado 📅' : 'Compromisso salvo');
      });
      const dlg = dialog(form);
      f.title.focus();
    }

    function manage() {
      const list = h('div', { class: 'ag-cals' });
      const msg = h('p', { class: 'muted', role: 'status' });
      const say = (text, bad) => { msg.textContent = t(text); msg.classList.toggle('err', !!bad); };
      const url = h('input', { type: 'url', placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics', spellcheck: false, style: 'flex: 1; min-width: 0' });
      const file = h('input', { type: 'file', accept: '.ics,text/calendar', hidden: true });

      const draw = () => {
        list.replaceChildren(...cal.calendars.map((c) => h('div', { class: 'ag-cal' },
          h('input', { type: 'checkbox', checked: c.visible !== false, title: 'Mostrar', onchange: (e) => updateCalendarMeta(c.id, { visible: e.target.checked }) }),
          h('input', { type: 'color', value: c.color || COLORS[0], title: 'Cor', onchange: (e) => updateCalendarMeta(c.id, { color: e.target.value }) }),
          h('div', { class: 'grow' },
            h('b', {}, c.name),
            h('small', { class: c.error ? 'err' : 'muted' }, c.type === 'local' ? `${cal.events.length} ${t('compromisso(s) · criados aqui')}` : c.error ? t(c.error) : `${c.count ?? 0} ${t('evento(s) · atualizado')} ${c.lastSync ? new Date(c.lastSync).toLocaleString(loc(), { dateStyle: 'short', timeStyle: 'short' }) : '—'}`)),
          c.type === 'ics' ? h('button', { class: 'btn', type: 'button', title: 'Atualizar agora', onclick: async () => { say('Atualizando…'); cal = await refreshFeeds({ only: c.id, force: true }); draw(); say(cal.calendars.find((x) => x.id === c.id)?.error || '✓ Atualizada.', !!cal.calendars.find((x) => x.id === c.id)?.error); } }, '↻') : null,
          c.type === 'ics' ? h('button', { class: 'btn', type: 'button', title: 'Remover esta agenda', onclick: async () => { if (!confirm(t('Remover esta agenda da NeuroTab? (Nada muda no serviço.)'))) return; await removeCalendar(c.id); cal = await loadCalendar(); draw(); } }, '✕') : null)));
      };

      const add = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        const u = normalizeFeedUrl(url.value);
        if (!u) return say('Link inválido. Cole o endereço que começa com https:// ou webcal://.', true);
        // pedir acesso ao site no próprio clique (sem await antes)
        const ok = await requestAccess({ origins: [new URL(u).origin + '/*'] });
        if (!ok) return say('Sem acesso ao site da agenda, não dá para baixar os eventos.', true);
        add.disabled = true;
        say('Baixando a agenda…');
        try {
          const c = await addFeed(u);
          cal = await loadCalendar();
          url.value = '';
          draw();
          say(`✓ ${c.name}: ${c.count} ${t('evento(s).')}`);
        } catch (e) { say(e.message, true); } finally { add.disabled = false; }
      } }, 'Adicionar');

      file.addEventListener('change', async () => {
        const fl = file.files?.[0];
        if (!fl) return;
        try { const n = await importICS(await fl.text()); cal = await loadCalendar(); draw(); say(`✓ ${n} ${t('evento(s) importado(s) para Minha agenda.')}`); } catch (e) { say(e.message, true); }
        file.value = '';
      });
      const exportBtn = h('button', { class: 'btn', type: 'button', onclick: () => {
        const blob = new Blob([toICS(cal.events, { name: 'NeuroTab' })], { type: 'text/calendar' });
        const a = h('a', { href: URL.createObjectURL(blob), download: 'neurotab-agenda.ics' });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      } }, '⬇️ Exportar minha agenda (.ics)');

      draw();
      dialog(h('form', { method: 'dialog' },
        h('h2', {}, 'Agendas'),
        list,
        h('h3', {}, 'Trazer uma agenda por link'),
        h('div', { class: 'row' }, url, add),
        h('details', { class: 'ag-help' }, h('summary', {}, 'Onde encontro o link?'),
          h('p', {}, h('b', {}, 'Google Agenda: '), 'no computador, Configurações → clique na agenda → "Integrar agenda" → copie o "Endereço secreto no formato iCal".'),
          h('p', {}, h('b', {}, 'Outlook: '), 'Configurações → Agenda → Agendas compartilhadas → "Publicar uma agenda" → copie o link ICS.'),
          h('p', {}, h('b', {}, 'iCloud: '), 'no app Calendário, compartilhe a agenda como "Agenda pública" e copie o link (webcal://).'),
          h('p', { class: 'muted' }, h('span', {}, 'O link é só leitura e fica guardado só neste navegador.'), ' ', h('span', {}, `A NeuroTab atualiza a cada ${REFRESH_MIN} minutos.`), ' ', h('span', {}, 'Quem tiver o link consegue ver a agenda: não compartilhe.'))),
        msg,
        h('div', { class: 'actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, '📂 Importar arquivo .ics'), file,
          exportBtn,
          h('button', { class: 'btn primary', value: 'ok' }, 'Fechar'))), { wide: true });
    }

    // ---------- Dados ----------
    const reload = async () => { cal = await loadCalendar(); render(); };
    const onStore = (changes, area) => { if (area === 'local' && (changes[CAL_KEY] || changes[CAL_CACHE_KEY])) reload(); };
    chrome.storage.onChanged.addListener(onStore);
    ctx.onCleanup(() => chrome.storage.onChanged.removeListener(onStore));
    ctx.every(60_000, render); // "agora" anda; eventos passados saem de "Próximos"
    reload().then(() => refreshFeeds().catch(() => {}));
    return {};
  },
};
