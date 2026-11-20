// NeuroTab — identificação do app nos provedores de login (OAuth).
// O "client ID" é público (aparece no endereço de login), não é segredo. Não há client secret: o login é
// feito inteiro no navegador (fluxo implícito do Google), sem servidor da NeuroTab.
// Como criar o cliente e quais endereços de retorno cadastrar: docs/dev/CONTAS.md.

export const OAUTH = {
  google: {
    clientId: '913281965961-kon02e6bh3tnfugcci53c65oiqvdpo12.apps.googleusercontent.com', // projeto neurotab-publicacao
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    baseScopes: ['openid', 'email', 'profile'],
  },
  microsoft: {
    clientId: '', // 0.7.6.3
  },
};

/** Permissões (escopos) por recurso. Cada recurso pede só a sua, quando é ligado. */
export const SCOPES = {
  google: {
    sync: ['https://www.googleapis.com/auth/drive.appdata'], // pasta oculta do app no Drive (não sensível)
    calendar: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'], // 0.7.6.2 (sensível)
  },
};
