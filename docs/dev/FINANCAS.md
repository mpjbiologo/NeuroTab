# Finanças (0.9.1, #66)

O widget **Finanças**, a página `src/finance.html` e a página de configurações *Nova aba → Finanças*. Os dados ficam só neste computador.

## Onde fica cada coisa

| Arquivo | O quê |
|---|---|
| `lib/finance/money.js` | Texto → centavos (`parseMoney`), formatação, divisão em parcelas que somam o total |
| `lib/finance/model.js` | Formato `nt_finance`, `sanitizeFinance`, faturas do cartão (`invoiceFor`, `cardInvoices`), `makeTx` (parcelas), saldos, resumo do mês, orçamento, contas a pagar (`billOccurrences`, `upcomingBills`, `payBill`), filtros, desfazer importação |
| `lib/finance/categorize.js` | Categorias padrão, regras embutidas, regras aprendidas (`learnRule`), `isBillPayment` |
| `lib/finance/dedupe.js` | Duplicados (FITID ou valor + data ±2 dias + descrição parecida) e pagamento de fatura → transferência |
| `lib/finance/import-ofx.js` | OFX 1.x (SGML) e 2.x (XML); exportar OFX |
| `lib/finance/import-csv.js` | Separador, títulos, colunas, datas (dmy/mdy, "05 NOV"), molde por assinatura dos títulos; exportar CSV |
| `lib/finance/import-pdf.js` | pdf.js (carregado só aqui), linhas remontadas pela posição, leitor genérico, molde por banco, OCR (tesseract) para PDF escaneado |
| `lib/finance/vault.js`, `store.js` | Cofre (AES-GCM 256, PBKDF2 600 mil rodadas, via `sync-crypto.js`), ler/salvar, bloquear, backup próprio, apagar tudo |
| `lib/finance/phrases.js` | "gastei 45 no mercado", "45 mercado", "+1200 salário", "300 tênis 3x no nubank" |
| `lib/finance/quick-add.js` | Lançar por frase (voz e Captura rápida) e "quanto gastei este mês?" |
| `lib/finance/notices.js` | Texto da notificação das contas a pagar e e-mails de fatura (só o assunto) |
| `lib/finance/prefs.js` | `settings.finance` (moeda, discreto, bloqueio, lembretes) — só as preferências sincronizam |

## Dados

```
nt_finance = { v, accounts[], cards[], categories[], rules[], tx[], bills[], budgets{}, imports[], templates{ csv{}, pdf{} } }
tx = { id, date 'AAAA-MM-DD', amount (centavos, sempre positivo), kind saida|entrada|transferencia, desc, cat,
       account, card?, invoice? 'AAAA-MM' (mês do vencimento), to? (transferência), inst? { n, of, group },
       source manual|voz|captura|ofx|csv|pdf|recorrente, fitid?, importId?, bill? }
```

- **Cartão:** a compra não mexe no saldo da conta; o **pagamento da fatura** é uma transferência da conta para o cartão (`to` = cartão, `invoice` = fatura). Assim o gasto conta uma vez só.
- **Fatura:** compras a partir do dia do fechamento caem na fatura seguinte. `invoice` é o mês do **vencimento**.
- **Resumo do mês:** pela data da compra (competência). Estorno no cartão abate o gasto. Transferências não contam.
- **Contas a pagar:** ocorrências mensais, anuais ou semanais; `paid['AAAA-MM']` aponta para o lançamento. Apagar o lançamento desmarca a conta.

## Cofre

- Desligado: `nt_finance` guarda o objeto direto.
- Ligado: `nt_finance = { sealed: true, salt, iter, env }`. A chave derivada fica em `chrome.storage.session` (`nt_fin_key`, só na memória do navegador) com prazo de `lockMin` minutos, renovado ao usar a página.
- Sem a chave, `loadFinance()` devolve `{ state: 'locked' }` e `saveFinance()` lança `LockedError`.
- Lembretes com o cofre bloqueado: o service worker não consegue ler, então espera.

## Fora do escopo desta versão

- Open Finance por agregador (Pluggy): 1.x.
- Sincronizar as finanças entre aparelhos.
- Regras próprias por banco para PDF: a 0.9.1 tem o leitor genérico + molde ensinado pela pessoa. Regras específicas entram quando houver amostras **anonimizadas**.
- Outras moedas por lançamento (hoje: uma moeda de exibição).

## Testes

`tests/unit/finance.test.js`, `tests/unit/finance-import.test.js` e `tests/e2e/finance.test.js` (gera um PDF mínimo sem bibliotecas para testar a leitura).

## Lint do Firefox

O pdf.js é copiado **sem alterações** (`scripts/vendor-pdfjs.mjs`) para a loja reconhecer a biblioteca. Ele traz 2 avisos `UNSAFE_VAR_ASSIGNMENT` (innerHTML nas camadas de texto e anotações, que a NeuroTab não usa): a linha de base do `npm run lint:firefox` passa de 7 para **9 avisos, 0 erros**.
