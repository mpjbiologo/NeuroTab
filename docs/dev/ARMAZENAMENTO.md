# Armazenamento e migrações

## Onde cada dado fica

| Onde | Chave / store | Conteúdo |
|---|---|---|
| `chrome.storage.local` | `nt_data` | Grupos, atalhos e todas as configurações (`settings`) |
| | `nt_brain` | Notas, tarefas, ideias, páginas e trechos |
| | `nt_trash` | Itens apagados (guardados por 30 dias) |
| | `nt_bg` | Imagem de fundo fixa (data URL) |
| | `nt_alarms`, `nt_timer`, `nt_pomo`, `nt_stopwatch`, `nt_sound` | Relógio |
| | `nt_habits`, `nt_focus` | Widgets Hábitos e Foco do dia |
| | `nt_meta` | Versão do esquema (`schema`) e histórico de migrações |
| | `nt_migration_backup` | Cópia de `nt_data`, `nt_brain` e `nt_trash` antes da última migração |
| | `nt_update`, `nt_whatsnew`, `nt_cache_*`, `nt_wx_*` | Avisos e caches (podem ser apagados sem perda) |
| IndexedDB `neurotab` (versão 3) | `photos` | Fotos do computador para os slides |
| | `vectors` | Índice da busca por significado (pode ser refeito) |
| | `captures` | Biblioteca de imagens |

As chaves de API ficam em `nt_data.settings.ai.keys` e `nt_data.settings.brapiToken` (ver [SEGURANCA.md](SEGURANCA.md)).

## Versões

- **Esquema dos dados** (`nt_meta.schema`): versão atual em `CURRENT_SCHEMA` (`src/lib/migrations.js`).
- **Banco IndexedDB**: versão em `src/lib/idb.js`; novas stores são criadas em `onupgradeneeded`, sem apagar as existentes.
- **Backup**: o arquivo leva `schema`. Backups de versão mais nova são recusados com mensagem clara; os antigos são normalizados na importação.

## Como funciona uma migração

`migrateIfNeeded()` roda antes da primeira leitura (`loadData` e `loadItems`), uma vez por página, com trava entre abas (`navigator.locks`).

1. Lê `nt_meta.schema`. Sem meta e com dados = versão 1. Sem nada = instalação nova (só marca a versão atual).
2. Aplica em memória cada passo de `MIGRATIONS` com `to` maior que a versão atual.
3. Grava tudo de uma vez: o novo estado, a cópia `nt_migration_backup` e o `nt_meta` novo.
4. Se um passo lançar erro, **nada é gravado** além de `nt_meta.lastError`; os dados ficam como estavam.
5. Dados de uma versão mais nova (extensão voltou de versão) não são tocados.

### Criar uma migração nova

```js
// src/lib/migrations.js
{
  to: 3,
  name: 'O que muda, em uma frase',
  up(state) {            // state = { nt_data, nt_brain, nt_trash } (podem faltar)
    const s = { ...state };
    // transforme sem efeitos colaterais; rodar duas vezes precisa dar o mesmo resultado
    return s;
  },
},
```

E um teste em `tests/unit/migrations.test.js` com dados no formato antigo (fixture em `tests/fixtures/`).

### Recuperar dados depois de uma migração com problema

A cópia anterior fica em `nt_migration_backup.data`. Para restaurar, no console da página de configurações:

```js
const { nt_migration_backup: b } = await chrome.storage.local.get('nt_migration_backup');
await chrome.storage.local.set({ ...b.data, nt_meta: { schema: b.from } });
```
