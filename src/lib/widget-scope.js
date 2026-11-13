// NeuroTab — escopo de um widget montado (#6).
// Guarda tudo o que o widget assina ou agenda e desfaz de uma vez ao desmontar,
// mesmo que o widget esqueça de limpar no destroy(). Montar e desmontar várias vezes
// não acumula listeners nem temporizadores.

export function createScope() {
  const cleanups = new Set();
  let disposed = false;

  /** Registra uma função de limpeza; devolve uma função que limpa já (e tira do escopo). */
  function add(fn) {
    if (typeof fn !== 'function') return () => {};
    if (disposed) { try { fn(); } catch { /* ignora */ } return () => {}; }
    let done = false;
    const run = () => { if (done) return; done = true; cleanups.delete(run); try { fn(); } catch (e) { console.error('NeuroTab: limpeza do widget', e); } };
    cleanups.add(run);
    return run;
  }

  return {
    add,
    /** setInterval que para sozinho ao desmontar. */
    every(ms, fn) { const id = setInterval(fn, ms); return add(() => clearInterval(id)); },
    /** setTimeout que é cancelado ao desmontar. */
    after(ms, fn) { const id = setTimeout(() => { stop(); fn(); }, ms); const stop = add(() => clearTimeout(id)); return stop; },
    /** addEventListener em window/document/qualquer alvo, removido ao desmontar. */
    listen(target, type, fn, opts) { target.addEventListener(type, fn, opts); return add(() => target.removeEventListener(type, fn, opts)); },
    /** Desfaz tudo (na ordem inversa do registro). */
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const run of [...cleanups].reverse()) run();
    },
    get size() { return cleanups.size; },
    get disposed() { return disposed; },
  };
}
