# Segurança das chaves de API

## Por onde a chave passa

| Etapa | Onde | Proteção |
|---|---|---|
| Digitada | Configurações → IA e voz (`#apiKey`, campo de senha) | Só aparece ao clicar em 👁 |
| Guardada | `chrome.storage.local` → `nt_data.settings.ai.keys[provedor]` | Acessível só pela própria extensão; **não é criptografada em repouso** (ver limites) |
| Usada | `src/lib/ai.js` e `src/lib/semantic.js`, no cabeçalho da requisição ao provedor escolhido | Nunca vai na URL; vai só para o domínio do provedor |
| Erros | Mensagens do provedor passam por `redact()` (`src/lib/secrets.js`) | Chaves conhecidas (`sk-…`, `AIza…`, `Bearer …`, `?key=`) e a própria chave são trocadas por "[chave oculta]" |
| Backup comum | `toBackup()` | Chaves e token da brapi **sempre removidos** |
| Backup com chaves | Opção marcada pela pessoa, com aviso | Com senha: AES-GCM 256 + PBKDF2-SHA256 (250 mil iterações), sal e IV aleatórios (`src/lib/crypto.js`, Web Crypto). Sem senha: confirmação extra |
| Removida | Botão 🗑 ao lado do campo da chave | Apaga a chave daquele provedor |

Nenhuma chave é registrada no console nem enviada a outro lugar. A NeuroTab não tem servidor nem telemetria.

## Limites (o que a extensão não consegue proteger)

- Quem tiver acesso ao **perfil do navegador** no seu computador consegue ler os dados das extensões, inclusive as chaves. Criptografar em repouso exigiria pedir uma senha a cada uso; preferimos não oferecer uma falsa sensação de segurança.
- Use chaves com limite de gasto (Gemini e OpenAI permitem) e apague as que não usa mais.
- Um backup **sem senha** com chaves é tão sensível quanto as chaves.

## Testes

`tests/unit/crypto-secrets.test.js` (ida e volta, senha errada, dados adulterados, sal/IV novos, ocultação) e `tests/unit/store.test.js` (backup comum nunca leva chaves). Fluxo completo em `tests/e2e/backup.test.js`.
