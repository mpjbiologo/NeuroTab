// Widget: calculadora, conversor e calculadoras de saúde (opcional).
import { h } from '../lib/ui.js';
import { smartCalc, fmtNum, imc, tmb, agua, ACTIVITY, parseNum } from '../lib/calc.js';

const HIST = 'nt_calc_history';

export default {
  id: 'calc',
  title: 'Calculadora',
  icon: '🧮',
  description: 'Contas, porcentagem, conversões (moedas, medidas, temperatura, datas) e calculadoras de saúde.',
  defaultW: 4,
  mount(el, ctx) {
    let tab = 'calc';
    const healthBtn = h('button', { title: 'Mostrar calculadoras de saúde', onclick: () => { ctx.saveWidget({ health: !ctx.widget.health }); paintTabs(); } }, '❤️');
    ctx.actions.append(healthBtn);
    const tabsRow = h('div', { class: 'toolbar tabs-row' });
    const body = h('div');
    el.append(tabsRow, body);

    function paintTabs() {
      healthBtn.classList.toggle('sel', !!ctx.widget.health);
      if (!ctx.widget.health) tab = 'calc';
      tabsRow.hidden = !ctx.widget.health;
      tabsRow.replaceChildren(...[['calc', '🧮 Calcular'], ['health', '❤️ Saúde']].map(([k, l]) =>
        h('button', { class: 'chip' + (tab === k ? ' sel' : ''), onclick: () => { tab = k; paintTabs(); } }, l)));
      render();
    }

    function calcView() {
      const input = h('input', { type: 'text', placeholder: 'Ex.: 200 + 10%   ·   100 usd em brl   ·   dias até 25/12', autocomplete: 'off', spellcheck: false });
      const out = h('div', { class: 'calc-out' }, '0');
      const err = h('div', { class: 'muted small' });
      const hist = h('div', { class: 'calc-hist' });
      let last = null;
      const paintHist = async () => {
        const list = (await chrome.storage.local.get(HIST))[HIST] || [];
        hist.replaceChildren(...list.slice(0, 8).map((x) => h('div', { class: 'hrow', title: 'Usar de novo', onclick: () => { input.value = x.q; run(); input.focus(); } }, h('span', { class: 'muted' }, x.q), h('b', {}, x.r))));
        if (list.length) hist.append(h('button', { class: 'linkish', onclick: async () => { await chrome.storage.local.remove(HIST); paintHist(); } }, 'Limpar histórico'));
      };
      const run = async (save) => {
        const q = input.value.trim();
        err.textContent = '';
        if (!q) { out.textContent = '0'; return; }
        try {
          const r = await smartCalc(q);
          last = r;
          out.textContent = r.text.includes('=') || /faltam|dias|feira|sábado|domingo/i.test(r.text) ? r.text : '= ' + r.text;
          if (save) {
            const list = (await chrome.storage.local.get(HIST))[HIST] || [];
            await chrome.storage.local.set({ [HIST]: [{ q, r: r.text }, ...list.filter((x) => x.q !== q)].slice(0, 30) });
            paintHist();
          }
        } catch (e) {
          if (save) err.textContent = e.message;
        }
      };
      let t;
      input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => run(false), 250); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(true); if (e.key === 'Escape') { input.value = ''; run(); } });
      out.addEventListener('click', async () => {
        if (!last) return;
        await navigator.clipboard.writeText(Number.isFinite(last.value) && !/\D{3,}/.test(out.textContent) ? String(last.value).replace('.', ',') : last.text);
        ctx.toast('Resultado copiado');
      });
      paintHist();
      return [input, out, err, hist,
        h('details', { class: 'muted small' }, h('summary', {}, 'O que dá para fazer?'),
          h('div', {}, '2^10 · raiz 81 · (3+4)*2 · 15% de 200 · 200 − 10%', h('br'), '10 km em milhas · 2 xícaras em ml · 37 c em f · 70 kg em lb', h('br'), '100 usd em brl · 1 btc em usd · 50 eur em reais', h('br'), 'dias até 25/12 · dias desde 01/01/2026 · daqui a 90 dias'))];
    }

    function healthView() {
      const f = (label, el) => h('label', { class: 'hf' }, h('span', {}, label), el);
      const sexo = h('select', {}, new Option('Masculino', 'm'), new Option('Feminino', 'f'));
      const idade = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'anos' });
      const peso = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'kg' });
      const altura = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'cm' });
      const atv = h('select', {}, ...ACTIVITY.map(([v, l]) => new Option(l, v)));
      const res = h('div', { class: 'health-res' });
      const saved = ctx.widget.healthData || {};
      sexo.value = saved.sexo || 'm'; idade.value = saved.idade || ''; peso.value = saved.peso || ''; altura.value = saved.altura || ''; atv.value = saved.atv || '1.2';
      let saveT;
      const calc = () => {
        const p = parseNum(peso.value);
        const a = parseNum(altura.value);
        const i = parseNum(idade.value);
        res.replaceChildren();
        if (!(p > 0)) return;
        const rows = [];
        if (a > 0) {
          const r = imc(p, a > 3 ? a / 100 : a);
          rows.push(['IMC', `${fmtNum(r.value, 1)} kg/m²`, r.classe]);
        }
        if (a > 0 && i > 0) {
          const b = tmb({ sexo: sexo.value, peso: p, alturaCm: a > 3 ? a : a * 100, idade: i });
          rows.push(['Taxa metabólica basal', `${fmtNum(Math.round(b))} kcal/dia`, 'Mifflin-St Jeor']);
          rows.push(['Gasto energético total', `${fmtNum(Math.round(b * +atv.value))} kcal/dia`, `fator de atividade ${String(atv.value).replace('.', ',')}`]);
        }
        rows.push(['Água', `${fmtNum(agua(p) / 1000, 1)} L/dia`, '35 ml por kg']);
        res.append(...rows.map(([k, v, s]) => h('div', { class: 'q-row' }, h('span', { class: 'n' }, k, ' ', h('small', {}, s)), h('b', {}, v))));
        res.append(h('p', { class: 'muted small' }, 'Estimativas para referência. Não substituem avaliação profissional.'));
        clearTimeout(saveT);
        saveT = setTimeout(() => ctx.saveWidget({ healthData: { sexo: sexo.value, idade: idade.value, peso: peso.value, altura: altura.value, atv: atv.value } }), 800);
      };
      [sexo, idade, peso, altura, atv].forEach((x) => x.addEventListener('input', calc));
      setTimeout(calc);
      return [h('div', { class: 'health-grid' }, f('Sexo', sexo), f('Idade', idade), f('Peso', peso), f('Altura', altura)), f('Atividade física', atv), res];
    }

    function render() {
      body.replaceChildren(...(tab === 'health' ? healthView() : calcView()));
      body.querySelector('input')?.focus({ preventScroll: true });
    }
    paintTabs();
  },
};
