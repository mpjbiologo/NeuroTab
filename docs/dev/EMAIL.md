# E-mail (0.7.7.4, #20)

Widget **E-mail** com os não lidos de várias contas, avisos de e-mail novo e um clique para abrir a mensagem no provedor.

## Peças

| Arquivo | O que faz |
|---|---|
| `src/lib/mail.js` | Adaptadores por provedor, leitura do feed, contas, novos sem repetir, textos dos avisos, desconectar. |
| `src/widgets/email.js` | Widget: contas (com contagem), lista, filtro por conta, tarefa "Responder", configurações. |
| `src/background.js` | Alarme `mail` (a cada 2 a 60 min), avisos do navegador, clique no aviso abre a mensagem. |

## Provedores

| Provedor | Como | Situação |
|---|---|---|
| **Gmail** | Feed oficial do próprio Gmail (`https://mail.google.com/mail/u/N/feed/atom[/rótulo]`), com a sessão já aberta neste navegador. Permissão opcional `https://mail.google.com/*`, pedida no widget. | 0.7.7.4 |
| **Outlook / Microsoft 365** | Microsoft Graph (`Mail.ReadBasic`) pela conta Microsoft conectada. | 0.7.7.5 |
| **iCloud e outros (IMAP)** | Não há caminho oficial: o navegador não fala IMAP e a extensão não guarda senhas. Ficaria só com um programa local (como a NeuroTab Ponte), avaliado depois. | — |

**Por que não usar a API do Gmail:** qualquer permissão para ler e-mails (`gmail.readonly`, `gmail.metadata`) é "restrita" no Google e exige uma auditoria de segurança paga todo ano. O feed dá exatamente o que o widget precisa (não lidos com remetente, assunto, trecho e hora) sem token nem senha.

## Contas
- Achadas procurando as sessões `u/0`, `u/1`… (até 6), parando quando o Gmail repete a `u/0` (ele faz isso para sessões que não existem).
- Cada conta: mostrar, avisar e "quais e-mails" (caixa de entrada, só importantes, só a aba Principal).
- Conta que saiu do Gmail fica marcada como ausente, com aviso no widget, até a pessoa entrar de novo ou removê-la.
- O armazenamento do Chrome não guarda a ordem das chaves: o widget ordena pela posição no Gmail.

## Avisos
- A primeira leitura de uma conta **não avisa** (é o que já estava lá). Depois, só os ids novos; até 300 ids lembrados por conta.
- Até 3 avisos separados por verificação; mais que isso, um aviso resumido por conta.
- Desligar por conta, desligar tudo, ou silenciar por 1 h, 4 h ou até amanhã às 8 h.
- Clicar no aviso abre a mensagem no Gmail (o link fica só em `storage.session`).

## Dados
- `nt_mail_cfg`: `{ enabled, interval, notify, muteUntil, accounts: { 'gmail:<email>': { provider, index, email, show, notify, filter, missing? } } }`
- `nt_mail`: `{ byAccount: { [conta]: { unread, entries: [{ id, subject, snippet, from, fromEmail, at, link }], fetchedAt, error } }, seen, checkedAt }`
- Só neste computador: não sincroniza, não vai para o backup nem para a IA. **Desconectar e apagar** remove os dois e devolve a permissão do Gmail.

## Testes
- `tests/unit/mail.test.js`: feed (acentos, entidades, CDATA), contas (u/N, repetição, sem sessão), escolhas, novos sem repetir, filtro, conta que saiu, avisos (resumo, silenciar), erros por conta.
- `tests/e2e/email.test.js`: conectar, duas contas, filtro, tarefa, aviso de e-mail novo no fundo sem repetir, configurações, desconectar apagando tudo.
- Feed de teste: `tests/fixtures/gmail-atom.js`.
