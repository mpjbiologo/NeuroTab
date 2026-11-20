# Agenda (0.7.6, #26)

| Arquivo | O que faz |
|---|---|
| `src/lib/tz.js` | Fusos sem biblioteca, pelo `Intl`: horário de parede ↔ instante (com horário de verão), nomes de fuso do Windows, datas de calendário. |
| `src/lib/ics.js` | Lê e gera iCalendar (RFC 5545): VEVENT, RRULE, EXDATE, RECURRENCE-ID, STATUS:CANCELLED, TZID, dia inteiro, DURATION, VALARM, linhas dobradas e escapes. |
| `src/lib/calendar.js` | Agendas (local + por link), eventos locais, expansão de recorrências (`occurrences`, `eventsBetween`), baixar/atualizar links, importar, textos para o cérebro (`agendaText`, `calendarContext`). |
| `src/widgets/agenda.js` | Widget: Próximos, Dia, Semana, Mês; diálogo de compromisso; diálogo de agendas (links, cor, visibilidade, importar/exportar). |
| `src/background.js` | Avisos (`cal-…` nos alarmes do navegador, janela de 48 h) e atualização dos links a cada 30 min (`calfeeds`). |

## Dados

- `nt_calendar`: `{ calendars: [{ id, type: 'local'|'ics', name, color, visible, url?, lastSync?, error?, count? }], events: [...] }` (eventos da agenda local).
- `nt_calendar_cache`: `{ [calId]: { events, fetchedAt } }` (eventos baixados dos links; não vão para o backup como dados próprios).
- `nt_calendar_sent`: avisos já mostrados (não repete; limpa depois de 4 dias).

Evento: `{ id, uid, cal, title, location, notes, url, allDay, tz, start, end, rrule, exdates, overrides, alarm }`.
`start`/`end` são **horário de parede** (`AAAA-MM-DDTHH:MM`) no fuso `tz`, ou datas `AAAA-MM-DD` (dia inteiro, fim exclusivo). Assim a recorrência "toda segunda às 9h" continua às 9h depois do horário de verão. A ocorrência é identificada pela chave de parede do início (a mesma do `RECURRENCE-ID`/`EXDATE`).

## Regras

- Links `webcal://` viram `https://`. O acesso ao site é pedido no clique em Adicionar (permissão opcional por site).
- Agenda por link é só leitura. "Copiar para minha agenda" cria um evento local.
- Erro ao atualizar não apaga os eventos antigos: fica a mensagem na agenda e no rodapé do widget.
- Recorrência diária/semanal sem COUNT pula direto para perto do intervalo pedido (eventos antigos não percorrem anos de dias); limite de 4000 passos.
- Importar `.ics` usa o UID: importar de novo atualiza, não duplica.

## Próximo passo: login nas contas (0.7.6.1)

Criar e editar eventos no Google e na Microsoft exige OAuth:
- **Google:** projeto no Google Cloud, cliente OAuth do tipo "Aplicativo da Web" com os endereços de retorno de cada navegador (`https://<id>.chromiumapp.org/` no Chrome e no Edge, cada um com seu id; `https://<hash>.extensions.allizom.org/` no Firefox), escopo `calendar.events`. Com mais de 100 pessoas, o Google exige verificação do app (política de privacidade, vídeo de demonstração).
- **Microsoft:** registro de app no Entra ID (gratuito), plataforma SPA com PKCE, escopo `Calendars.ReadWrite`.
- Login por `chrome.identity.launchWebAuthFlow` (funciona nos três navegadores). O token fica só no navegador.

## Testes

- `tests/unit/calendar.test.js`: fusos (inclusive horário de verão de Nova York), .ics do Google, recorrências (semanal com dias, contagem, exceção, movida; diária com UNTIL; mensal 2ª terça e último dia; anual; dia 31), evento antigo, geração de .ics, agenda local, links com erros, respostas do cérebro. Roda certo em qualquer fuso (`TZ=...`).
- `tests/e2e/agenda.test.js`: criar/editar/excluir pela tela, link do Google com permissão e erro, importar arquivo, aviso agendado, "o que tenho pra hoje".
