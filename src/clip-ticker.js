// Relógio da leitura da área de transferência (roda num worker: o Chrome desacelera os temporizadores de
// documentos ocultos para uma vez por minuto depois de alguns minutos; os de um worker não).
let timer = null;
self.onmessage = (e) => {
  clearInterval(timer);
  timer = e.data?.every ? setInterval(() => self.postMessage(0), e.data.every) : null;
};
