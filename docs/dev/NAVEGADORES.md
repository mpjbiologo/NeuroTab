# Matriz de navegadores

Versões mínimas: **Chrome/Edge 116+** (Manifest V3 com service worker, `offscreen`, `navigator.locks`) e **Firefox 128+** (`strict_min_version` no pacote do Firefox).

Legenda: ✅ automatizado no CI · 🖐 testar à mão antes de publicar · ➖ não se aplica / limitação conhecida

| Recurso | Chromium (CI) | Edge | Chrome | Firefox | Observações |
|---|---|---|---|---|---|
| Instalar e abrir nova aba, configurações e popup | ✅ | 🖐 | 🖐 | 🖐 | Firefox: `about:debugging` → Carregar extensão temporária |
| Interface em pt/en/es | ✅ | 🖐 | 🖐 | 🖐 | |
| Atalhos, grupos, busca (Ctrl+K), calculadora | ✅ | 🖐 | 🖐 | 🖐 | |
| Widgets, modo livre, camadas | ✅ | 🖐 | 🖐 | 🖐 | |
| Backup e restauração (com e sem chaves) | ✅ | 🖐 | 🖐 | 🖐 | |
| Migração de dados antigos e IndexedDB | ✅ | 🖐 | 🖐 | 🖐 | |
| Biblioteca de imagens: colar | ✅ | 🖐 | 🖐 | 🖐 | |
| Biblioteca de imagens: menu "Salvar imagem" | ➖ | 🖐 | 🖐 | 🖐 | O pedido de permissão no menu não é automatizável; há janela de reserva |
| IA (Gemini etc.) e busca por significado | ✅ (simulada) | 🖐 | 🖐 | 🖐 | Testar com uma chave real |
| Comandos de voz e palavra de ativação | ✅ (simulada) | 🖐 | 🖐 | ➖ | Firefox não tem reconhecimento de voz; a opção some |
| Leitura em voz alta | ✅ (simulada) | 🖐 | 🖐 | 🖐 | |
| Lembretes, alarmes e notificações | ➖ | 🖐 | 🖐 | 🖐 | Som: offscreen (Chromium) / página de fundo (Firefox) |
| Permissões opcionais (Permitir/Remover) | ✅ (painel) | 🖐 | 🖐 | 🖐 | O clique em "Permitir" do navegador é manual |
| Mapa do Waze, Bing, NASA, RSS reais | ➖ | 🖐 | 🖐 | 🖐 | Dependem de serviços externos |

## Roteiro rápido de teste manual (10 min)

1. Instalar o zip; abrir uma nova aba; conferir relógio, clima e saudação.
2. Configurações → Geral → Idioma: trocar para English e Español e voltar.
3. Captura rápida: salvar uma nota com "me lembre em 1 minuto de testar"; esperar a notificação e o som.
4. Colar uma imagem (Ctrl+V) e salvar; botão direito numa imagem de um site → NeuroTab → Salvar imagem.
5. Widget Cotações → Permitir; Trânsito → buscar um endereço.
6. IA e voz: salvar uma chave, "Testar", ligar a busca por significado e indexar.
7. 🎙 (Alt+Shift+V): "o que eu tenho que fazer?" e "timer de 1 minuto".
8. Backup com chaves e senha; apagar a chave; importar o backup.

Anote o navegador e a versão no texto da release ("Testado em: Edge 1xx, Firefox 1xx").
