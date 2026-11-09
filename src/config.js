// Configuração do projeto — edite aqui os links de apoio/doação.
// Itens com valor vazio não aparecem na página de configurações.
export const PROJECT = {
  name: 'NeuroTab',
  repo: 'https://github.com/mpjbiologo/NeuroTab',
  site: 'https://mpjbiologo.github.io/NeuroTab/',
  issues: 'https://github.com/mpjbiologo/NeuroTab/issues',
  author: 'Marcos de Paula Júnior',
};

export const DONATION = {
  // Pix: o QR Code e o "copia e cola" são gerados automaticamente.
  pix: {
    key: 'prof.marcosbiologo@gmail.com',
    name: 'Marcos de Paula Junior', // nome do recebedor (até 25 letras, sem acento)
    city: 'Itauna',
    message: 'Apoio NeuroTab',
  },
  // Outros links. Ex.: { label: 'Ko-fi', url: 'https://ko-fi.com/seuusuario', icon: '☕' }
  links: [
    { label: 'Ko-fi', url: 'https://ko-fi.com/marcosdepaulajunior', icon: '☕' },
    { label: 'PayPal', url: 'https://www.paypal.com/donate/?hosted_button_id=ZJ2SZQ4L5ZND4', icon: '🅿️' },
    // { label: 'GitHub Sponsors', url: 'https://github.com/sponsors/mpjbiologo', icon: '💜' }, // depois da aprovação
  ],
};
