# Contas e sincronização (0.7.6.1)

Login com Google (várias contas) e sincronização criptografada pela pasta oculta do app no Google Drive (#27).
Microsoft (Outlook + OneDrive) vem na 0.7.6.3; agenda pela conta Google na 0.7.6.2.

## Peças

| Arquivo | O que faz |
|---|---|
| `src/lib/oauth-config.js` | Client ID de cada provedor (público, não é segredo) e permissões por recurso. |
| `src/lib/accounts.js` | Contas (várias), login por `identity.launchWebAuthFlow`, renovação silenciosa (`prompt=none`), `authFetch`, desconectar com revogação. |
| `src/lib/sync-crypto.js` | Senha → chave (PBKDF2-SHA256, 600 mil rodadas) → AES-GCM 256. Sem senha: envelope legível. |
| `src/lib/sync.js` | Categorias, mescla de 3 vias por registro, Google Drive (`appDataFolder`), ligar/desligar/apagar. |
| `src/options-accounts.js` | Aba "Contas e sincronização". |
| `src/background.js` | Sincroniza 15 s depois de uma mudança, a cada 5 min (`ntsync`) e ao abrir o navegador. Nunca abre login sozinho. |

## Dados

- `nt_accounts`: contas (id `google:<sub>`, e-mail, nome, foto, escopos concedidos).
- `nt_account_tokens`: acessos temporários (1 h). **Nunca** vão para backup nem sincronização.
- `nt_sync`: configuração (conta, modo `key`/`none`, categorias, pausa, situação).
- `nt_sync_key`: chave derivada da senha, só neste navegador.
- `nt_sync_state`: base da mescla (impressão de cada registro) e versão de cada arquivo no Drive.
- `nt_oauth_override`: client ID colado em Contas → "Para quem configura o login" (só para testar antes de gravar no código).

Na nuvem (pasta `appDataFolder`, invisível no Drive): `nt-sync-meta.json` (modo, sal, verificação da senha) e um arquivo por categoria: `nt-brain.json`, `nt-shortcuts.json`, `nt-settings.json`, `nt-agenda.json`, `nt-habits.json`. Cada um é `{ v, alg, iv, ct }` (com senha) ou `{ v, alg: 'none', data }`.

## Regras da mescla

Por registro, comparando com a base (o que foi sincronizado da última vez):

| Situação | Resultado |
|---|---|
| Só um lado mudou | Vale esse lado (inclusive exclusão) |
| Excluído de um lado, editado do outro | Fica o editado (nada some sem querer) |
| Os dois mudaram (notas, eventos) | Vale o mais recente; no cérebro, a outra versão fica como nota "⚠️ …" (cópia em conflito) |
| Os dois mudaram (configurações, atalhos) | Primeiro contato: vale a nuvem (o aparelho que chega adota). Depois: vale este aparelho |

Marcas de exclusão ficam 60 dias. Antes de gravar, confere a versão do arquivo no Drive; se outro aparelho gravou no meio, refaz (até 3 vezes). Chaves de API (`settings.ai.keys`) nunca saem; cada aparelho mantém as suas. Grupos vazios do aparelho que chega (o "Principal" de toda instalação nova) não duplicam os da nuvem.

## Configurar o login com Google (uma vez)

### 1. Domínio verificado (grátis)
O Google pede um domínio provado como seu na tela de consentimento.
1. Crie o repositório **`mpjbiologo/mpjbiologo.github.io`** (público) com um `index.html` que redireciona para `/NeuroTab/`.
2. No [Google Search Console](https://search.google.com/search-console), adicione a propriedade **Prefixo do URL** `https://mpjbiologo.github.io/`, escolha **Arquivo HTML**, baixe o arquivo `googleXXXX.html` e coloque-o na raiz desse repositório. Clique em Verificar.

### 2. Projeto no Google Cloud
1. [console.cloud.google.com](https://console.cloud.google.com) → **Novo projeto** → nome `NeuroTab`.
2. **APIs e serviços → Biblioteca**: ative **Google Drive API** (e, para a 0.7.6.2, **Google Calendar API**).

### 3. Tela de consentimento (Google Auth Platform → Branding)
| Campo | Valor |
|---|---|
| Nome do app | `NeuroTab` |
| E-mail de suporte | o seu e-mail de contato dos apps |
| Logotipo | `icons/icon128.png` (120×120) |
| Página inicial | `https://mpjbiologo.github.io/NeuroTab/` |
| Política de privacidade | `https://mpjbiologo.github.io/NeuroTab/privacy.html` |
| Domínios autorizados | `mpjbiologo.github.io` |

**Público-alvo:** Externo. **Escopos (Acesso a dados):** `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `.../auth/drive.appdata`. Só com esses (não sensíveis), o app pode ser **publicado em produção sem verificação** e qualquer pessoa entra. A agenda (`calendar.events`) é sensível e entra depois, com a verificação.

### 4. Cliente OAuth (Google Auth Platform → Clientes → Criar cliente)
Tipo **Aplicativo da Web**, nome `NeuroTab (extensão)`. Em **URIs de redirecionamento autorizados**, cadastre:

| Navegador | Endereço de retorno |
|---|---|
| Chrome (loja) | `https://dbdilojkiedjgjehfjpodbljcnpmljkk.chromiumapp.org/` |
| Edge (loja) | `https://mhaainpmhalhhbefceigjmbcdhdeainl.chromiumapp.org/` |
| Firefox (AMO) | `https://a9bd2b9d2d33dad1b43883e994c8b78fbd94fc75.extensions.allizom.org/` |

Confira cada um em Configurações → Contas e sincronização → "Para quem configura o login", aberto naquele navegador (é o endereço que o próprio navegador informa). Uma extensão carregada sem empacotar tem outro ID: cadastre também o endereço que aparecer lá, se for testar assim.

Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`). Não há segredo de cliente a guardar: o login é todo no navegador.

### 5. Testar e gravar
- Para testar já: cole o ID em Contas → "Para quem configura o login" → Salvar, e conecte a conta.
- Para todos: o ID fica em `src/lib/oauth-config.js` (`OAUTH.google.clientId`). Projeto `neurotab-publicacao`, ID `913281965961-kon02e6bh3tnfugcci53c65oiqvdpo12.apps.googleusercontent.com`. Com ele no código, o campo de teste some da aba.

## Limites conhecidos

- **Duração do login:** o acesso do Google dura 1 hora e se renova em silêncio enquanto a pessoa estiver logada no Google naquele navegador. Se ela sair do Google, a sincronização mostra "É preciso entrar de novo na conta" e espera o próximo clique em "Sincronizar agora".
- **Senha esquecida:** sem a senha, a cópia na nuvem não abre. Os dados locais continuam. Saída: "Apagar dados da nuvem" e ligar de novo com uma senha nova.
- **Firefox:** pede consentimento de dados (`websiteContent`, `bookmarksInfo`) ao ligar a sincronização; a permissão `identity` vai nas permissões normais (lá não pode ser opcional e não mostra aviso).
- Imagens da biblioteca não sincronizam (arquivos grandes; etapa futura).

## Testes

- `tests/unit/sync.test.js`: criptografia, mescla de 3 vias (todos os casos da tabela), dois aparelhos por um Drive simulado (senha certa/errada, sem senha, exclusões, nada a fazer, apagar nuvem), endereço e resposta do login.
- `tests/e2e/accounts-sync.test.js`: na tela, com login e Drive simulados: client ID de teste, conectar, ligar com senha (arquivos cifrados), sincronizar agora, apagar nuvem, desconectar (revoga).
