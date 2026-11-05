// Widget: relógio — despertador, timer, pomodoro e cronômetro.
import { h } from '../lib/ui.js';
import * as C from '../lib/clock.js';
import { SOUNDS } from '../lib/sounds.js';

const TABS = [['alarm', '⏰ Despertador'], ['timer', '⏱ Timer'], ['pomo', '🍅 Pomodoro'], ['sw', '⏲ Cronômetro']];

export default {
  id: 'clock',
  title: 'Relógio',
  icon: '⏱',
  description: 'Despertador, timer, pomodoro e cronômetro — com som e notificação.',
  defaultW: 4,
  mount(el, ctx) {
    let tab = ctx.widget.tab || 'alarm';
    let st = {};
    const ringing = h('div', { class: 'ringing', hidden: true }, h('span', {}, '🔔 Tocando'), h('button', { class: 'btn primary', onclick: () => C.stopSound() }, 'Parar som'));
    const chips = TABS.map(([k, label]) => h('button', { class: 'chip' + (k === tab ? ' sel' : ''), onclick: () => { tab = k; ctx.saveWidget({ tab: k }); chips.forEach((c, i) => c.classList.toggle('sel', TABS[i][0] === k)); render(); } }, label));
    const body = h('div', { class: 'clk' });
    el.append(ringing, h('div', { class: 'toolbar tabs-row' }, ...chips), body);

    async function load() {
      const r = await chrome.storage.local.get(Object.values(C.K));
      st = {
        alarms: r[C.K.alarms] || [],
        timer: r[C.K.timer] || { endAt: null },
        pomo: { ...C.POMO_DEFAULT, ...(r[C.K.pomo] || {}) },
        sw: r[C.K.stopwatch] || { running: false, elapsed: 0, laps: [] },
        sound: r[C.K.sound] || {},
      };
      ringing.hidden = !st.sound.playing;
      render();
    }

    // ---------- Despertador ----------
    function alarmView() {
      const list = h('div', { class: 'items' });
      if (!st.alarms.length) list.append(h('p', { class: 'muted' }, 'Nenhum despertador. Crie um abaixo.'));
      for (const al of st.alarms) {
        const next = al.enabled ? (al.snoozeUntil > Date.now() ? al.snoozeUntil : C.nextOccurrence(al)) : null;
        list.append(h('div', { class: 'alarm-row' + (al.enabled ? '' : ' off') },
          h('div', { class: 'body' },
            h('div', { class: 'al-time' }, al.time),
            h('div', { class: 'muted' }, [al.label, C.describeDays(al.days), next && (al.snoozeUntil > Date.now() ? 'soneca ' : '') + C.untilText(next)].filter(Boolean).join(' · '))),
          h('label', { class: 'sw-mini' }, h('input', { type: 'checkbox', checked: al.enabled, onchange: (e) => C.updateAlarm(al.id, { enabled: e.target.checked }) }), h('span')),
          h('button', { class: 'x', title: 'Excluir', onclick: () => C.deleteAlarm(al.id) }, '✕')));
      }
      const days = new Set([1, 2, 3, 4, 5]);
      const time = h('input', { type: 'time', value: '07:00', class: 'field', style: { width: '110px' } });
      const label = h('input', { type: 'text', placeholder: 'Nome (opcional)' });
      const sound = h('select', {}, ...Object.entries(SOUNDS).map(([k, v]) => new Option(v, k)));
      const dayBtns = C.DAY_LABELS.map((d, i) => h('button', { class: 'day' + (days.has(i) ? ' sel' : ''), type: 'button', title: C.DAY_NAMES[i], onclick: (e) => { days.has(i) ? days.delete(i) : days.add(i); e.target.classList.toggle('sel'); } }, d));
      const form = h('div', { class: 'al-form', hidden: true },
        h('div', { class: 'row-input' }, time, label),
        h('div', { class: 'days' }, ...dayBtns, h('span', { class: 'muted' }, 'nenhum = uma vez')),
        h('div', { class: 'row-input' }, sound, h('button', { class: 'btn', type: 'button', title: 'Ouvir', onclick: () => chrome.runtime.sendMessage({ type: 'previewSound', kind: sound.value }) }, '🔊'),
          h('button', { class: 'btn primary', onclick: async () => { await C.addAlarm({ time: time.value, label: label.value.trim(), days: [...days], sound: sound.value }); ctx.toast('Despertador criado ⏰'); } }, 'Salvar')));
      const add = h('button', { class: 'btn', onclick: () => { form.hidden = !form.hidden; add.hidden = true; time.focus(); } }, '＋ Novo despertador');
      return [list, add, form, h('p', { class: 'muted small' }, 'Toca com o navegador aberto e o computador ligado.')];
    }

    // ---------- Timer ----------
    function timerView() {
      const t = st.timer;
      const running = !!t.endAt;
      const paused = t.pausedLeft != null;
      const left = running ? t.endAt - Date.now() : paused ? t.pausedLeft : 0;
      const custom = h('input', { type: 'text', placeholder: 'ex.: 7, 2:30, 1h15', style: { width: '120px' } });
      const start = (ms) => { if (ms > 0) C.startTimer(ms, ''); };
      const presets = [1, 3, 5, 10, 15, 25, 30, 60].map((m) => h('button', { class: 'chip', onclick: () => start(m * 60e3) }, m < 60 ? `${m} min` : '1 h'));
      custom.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(C.parseDuration(custom.value)); });
      return [
        h('div', { class: 'big-time', 'data-live': 'timer' }, running || paused ? C.fmtDur(left) : '00:00'),
        t.duration && (running || paused) ? h('div', { class: 'bar' }, h('i', { 'data-live': 'timerbar', style: { width: `${100 - (left / t.duration) * 100}%` } })) : null,
        running || paused
          ? h('div', { class: 'toolbar center' },
            running ? h('button', { class: 'btn', onclick: () => C.pauseTimer() }, '⏸ Pausar') : h('button', { class: 'btn primary', onclick: () => C.resumeTimer() }, '▶ Retomar'),
            h('button', { class: 'btn', onclick: () => C.resetTimer() }, '⏹ Zerar'))
          : h('div', {}, h('div', { class: 'toolbar center' }, ...presets), h('div', { class: 'toolbar center' }, custom, h('button', { class: 'btn primary', onclick: () => start(C.parseDuration(custom.value)) }, '▶ Iniciar'))),
      ];
    }

    // ---------- Pomodoro ----------
    function pomoView() {
      const p = st.pomo;
      const total = C.phaseMinutes(p) * 60e3;
      const left = p.running ? p.endAt - Date.now() : p.pausedLeft ?? total;
      const label = p.phase === 'focus' ? `🍅 Foco · ciclo ${p.cycle}` : p.phase === 'long' ? '🌿 Pausa longa' : '☕ Pausa curta';
      const num = (k, min, max) => h('input', { type: 'number', min, max, value: p[k], style: { width: '64px' }, onchange: async (e) => { const r = await chrome.storage.local.get(C.K.pomo); await chrome.storage.local.set({ [C.K.pomo]: { ...C.POMO_DEFAULT, ...(r[C.K.pomo] || {}), [k]: Math.max(min, Math.min(max, +e.target.value || p[k])) } }); } });
      return [
        h('div', { class: 'muted center' }, label),
        h('div', { class: 'big-time', 'data-live': 'pomo' }, C.fmtDur(left)),
        h('div', { class: 'bar' }, h('i', { 'data-live': 'pomobar', style: { width: `${100 - (left / total) * 100}%` } })),
        h('div', { class: 'toolbar center' },
          p.running ? h('button', { class: 'btn', onclick: () => C.pausePomo() }, '⏸ Pausar') : h('button', { class: 'btn primary', onclick: () => C.startPomo() }, p.pausedLeft != null ? '▶ Retomar' : '▶ Iniciar'),
          h('button', { class: 'btn', onclick: () => C.skipPomo() }, '⏭ Pular'),
          h('button', { class: 'btn', onclick: () => C.stopPomo() }, '⏹ Parar')),
        h('details', { class: 'pomo-cfg' }, h('summary', { class: 'muted' }, 'Ajustar tempos'),
          h('div', { class: 'toolbar' }, h('span', { class: 'muted' }, 'Foco'), num('focusMin', 1, 120), h('span', { class: 'muted' }, 'Pausa'), num('breakMin', 1, 60), h('span', { class: 'muted' }, 'Longa'), num('longMin', 1, 60))),
      ];
    }

    // ---------- Cronômetro ----------
    function swView() {
      const s = st.sw;
      return [
        h('div', { class: 'big-time', 'data-live': 'sw' }, C.fmtDur(C.swElapsed(s), true)),
        h('div', { class: 'toolbar center' },
          h('button', { class: 'btn' + (s.running ? '' : ' primary'), onclick: () => C.swToggle() }, s.running ? '⏸ Pausar' : '▶ Iniciar'),
          h('button', { class: 'btn', disabled: !s.running, onclick: () => C.swLap() }, '🏁 Volta'),
          h('button', { class: 'btn', onclick: () => C.swReset() }, '⏹ Zerar')),
        s.laps.length ? h('div', { class: 'laps' }, ...s.laps.map((l, i) => h('div', {}, h('span', { class: 'muted' }, `Volta ${s.laps.length - i}`), h('span', {}, C.fmtDur(l, true))))) : null,
      ];
    }

    function render() {
      body.replaceChildren(...({ alarm: alarmView, timer: timerView, pomo: pomoView, sw: swView }[tab]()).filter(Boolean));
    }

    // Atualiza só os números a cada 200 ms.
    const tick = setInterval(() => {
      const q = (k) => body.querySelector(`[data-live="${k}"]`);
      if (tab === 'timer' && st.timer.endAt) {
        const left = st.timer.endAt - Date.now();
        q('timer') && (q('timer').textContent = C.fmtDur(Math.max(0, left)));
        q('timerbar') && (q('timerbar').style.width = `${100 - (left / st.timer.duration) * 100}%`);
      }
      if (tab === 'pomo' && st.pomo.running) {
        const left = st.pomo.endAt - Date.now();
        q('pomo') && (q('pomo').textContent = C.fmtDur(Math.max(0, left)));
        q('pomobar') && (q('pomobar').style.width = `${100 - (left / (C.phaseMinutes(st.pomo) * 60e3)) * 100}%`);
      }
      if (tab === 'sw' && st.sw.running) q('sw') && (q('sw').textContent = C.fmtDur(C.swElapsed(st.sw), true));
      if (tab === 'alarm' && Date.now() % 30000 < 210) render();
    }, 200);

    const onChange = (changes, area) => {
      if (area === 'local' && Object.values(C.K).some((k) => changes[k])) load();
    };
    chrome.storage.onChanged.addListener(onChange);
    load();
    return { destroy: () => { clearInterval(tick); chrome.storage.onChanged.removeListener(onChange); } };
  },
};
