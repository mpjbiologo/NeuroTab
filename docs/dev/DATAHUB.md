# Data Hub (0.9.2, #71)

Uma camada única para os dados externos: cotações, índices, indicadores e o clima extra. Os widgets pedem o dado; o hub escolhe a fonte, usa o cache, respeita a cota e devolve o valor **sempre com a fonte, o horário e o atraso**. Se nenhuma fonte responder, devolve o último valor marcado como **desatualizado** — nunca inventa.

## Arquivos

| Arquivo | O quê |
|---|---|
| `lib/datahub/prefs.js` | `settings.watch` (lista + intervalo) e `settings.datahub` (fontes ligadas, ordem, limites próprios, clima, alertas); `parseItem` ("petr4", "usd", "btc", "selic"); migração de `quoteCurrencies`/`quoteStocks` |
| `lib/datahub/keys.js` | Chaves de cada pessoa em `nt_datahub_keys` (storage.local, **não sincroniza**). Migra o antigo `settings.brapiToken` (que sincronizava). Trocar a chave limpa o cache |
| `lib/datahub/sources.js` | As fontes (`SOURCES`: o que o grátis cobre, como conseguir a chave) e as leituras puras de cada resposta |
| `lib/datahub/quota.js` | Uso por fonte (minuto, dia e mês) em `nt_dh_usage`, limites do grátis (ou os informados), pregão da B3, estimativa do mês e junção do uso de várias abas |
| `lib/datahub/hub.js` | `getQuotes(items, settings, { force })`, `getHgWeather`, `cityFromIp`, `testKey`, `cachedQuote` (síncrono, para o cérebro) |
| `lib/datahub/alerts.js` | Alertas com histerese (avisa uma vez; rearma quando volta) |
| `lib/datahub/format.js` | Preço, variação, "BrAPI · 14:05 · atraso de ~30 min", frase falada |

## Fontes e o que cada uma faz aqui

| Dado | Ordem padrão | Observações |
|---|---|---|
| Ações e FIIs | BrAPI → HG Brasil | BrAPI grátis: 15 mil/mês, 1 ativo por consulta, ~30 min de atraso; sem token só PETR4, VALE3, ITUB4 e MGLU3 |
| Índices (Ibovespa, IFIX) | BrAPI | `^BVSP` |
| Moedas | AwesomeAPI → HG Brasil | HG: `FOREX:USDBRL` |
| Cripto | AwesomeAPI | |
| SELIC, CDI, IPCA | Banco Central → HG Brasil | SGS 432 (meta SELIC), 4389 (CDI a.a.), 13522 (IPCA 12 meses); HG grátis: só `IBGE:IPCA` e `BCB:SELICMETA` |
| Clima extra | HG Brasil (opcional) | chance de chuva, sol, lua; o Open-Meteo continua o padrão e a reserva |
| Cidade pelo IP | HG Brasil | só no clique; 100 consultas por mês no grátis |

Moedas, cripto e indicadores **não** usam a BrAPI: no plano grátis dela esses dados não estão incluídos.

## Cache e cota

- Validade: ações e índices = intervalo escolhido (15 min a 2 h); moedas e cripto 10 min; indicadores 12 h; clima HG 60 min.
- Fora do pregão (dias úteis, 10h–18h de Brasília), ações e índices usam o último valor.
- Antes de cada consulta o hub confere a cota; esgotada, mostra o último valor como desatualizado e tenta a próxima fonte.
- "Plano pago" ou "não encontrado" apagam o valor antigo daquele ativo (ele nunca mais atualizaria).
- As buscas de uma mesma página são feitas uma de cada vez; o uso gravado junta o de outras abas (fica o maior).

## Alertas

`settings.datahub.alertsOn` (desligado por padrão) e `alerts[]`. O alarme `dhalerts` (service worker) roda a cada 30 min, usa o hub (cache e cota) e cria a notificação `dhalert:…`. Valor desatualizado não dispara.

## Permissões

- `quotes` (opcional): AwesomeAPI, BrAPI e **Banco Central** (`api.bcb.gov.br`, novo).
- `hgbrasil` (opcional, novo): `api.hgbrasil.com`, pedido em Configurações → Fontes de dados ao ligar a fonte ou testar a chave. No Firefox, com o consentimento de localização (coordenadas da cidade).

## Testes

`tests/unit/datahub.test.js` (respostas gravadas, cota, pregão, alertas, textos) e `tests/e2e/datahub.test.js` (rede simulada). O service worker não passa pela rede simulada do Playwright: o teste de alertas usa um valor já no cache.
