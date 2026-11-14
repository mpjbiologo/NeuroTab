# Caminho até a 1.0

Cada versão grande é um marco no GitHub, com as issues que entram nela. As versões grandes saem em atualizações menores (0.7.0, 0.7.1…) para as revisões das lojas serem rápidas. Estimativa: **10 a 12 atualizações** até a 1.0.

## O que a 1.0 promete

A 1.0 não é "ter todos os recursos". É poder dizer: **pode confiar seus dados à NeuroTab**.

- **Seus dados vão com você:** sincronização opcional e criptografada entre computadores.
- **Transparência:** um painel mostra o que sai do computador, para onde e por quê.
- **Base estável:** módulos com contratos claros, que crescem sem quebrar o resto.
- **Sem surpresas por navegador:** Chrome, Edge e Firefox passam pela mesma lista de testes a cada versão.

## Marcos

### [v0.7 — Base modular e painel](https://github.com/mpjbiologo/NeuroTab/milestone/3) · 5 atualizações
Primeiro a base, depois os recursos.
- ✅ **0.7.0 — Arquitetura modular:** `newtab.js` dividido em módulos (#14); botões flutuantes sem cobrir widgets (#38).
- ✅ **0.7.1:** barramento de eventos (#5) e contrato dos widgets (#6); o cérebro lê o widget de mapas (#43); maximizar, minimizar e restaurar widgets (#18).
- **0.7.2 — Assistente com nome e janelas organizadas:** nome do assistente, frase de ativação composta ("Acorde Verônica"), sinal sonoro e estados da escuta (#15); camadas centralizadas e nenhum painel fora da tela ou sobreposto sem querer (#35).
- **0.7.3 — O cérebro lê as imagens:** leitura das imagens da biblioteca pela IA da pessoa (com consentimento) e leitura de texto local, sem enviar nada (#17).
- **0.7.4 — Agenda:** agenda própria (dia, semana, mês, recorrência), importação de `.ics` e o cérebro respondendo sobre compromissos; contas Google/Microsoft numa etapa seguinte (#26).

### [v0.8 — Assistente de voz e modo reunião](https://github.com/mpjbiologo/NeuroTab/milestone/4) · 2 atualizações
- Responder falando ao ser chamado e conversar até 1 minuto de silêncio (#40).
- Modo reunião: gravar, transcrever, resumo, pontos importantes e tarefas, com botão 📋 perto do microfone (#41).
- Modo conversa: microfone sempre ligado e o cérebro responde a tudo, com botão 💬 perto do microfone (#44).
- Visual futurista da voz (#39).

### [v0.9 — Conhecimento e captura](https://github.com/mpjbiologo/NeuroTab/milestone/5) · 2 a 3 atualizações
- Separar provedores, embeddings e tarefas de IA (#7), base para o resto.
- NeuroPilot: sugestões proativas locais (#8).
- Central de conhecimento: fontes e documentos (#9) e adaptador opcional do Open Notebook (#10).
- Recorte de tela para a biblioteca (#37) e captura de arquivos pelo menu (#12).
- Modo Estudante (#11).
- Escolher a pasta das mídias e avaliar downloads de áudio e vídeo de sites, sem contornar DRM nem restrições (#45).

### [v1.0 — Estável e completa](https://github.com/mpjbiologo/NeuroTab/milestone/6) · 1 a 2 atualizações
- Sincronização opcional e criptografada entre dispositivos (#27).
- Painel de privacidade, permissões e fluxo de dados (#28).
- Matriz de testes funcionais para Chrome, Edge e Firefox (#13).
- Configurações com visual novo e identidade própria (#46).
- Revisão geral: textos, acessibilidade, desempenho e documentação.

### [1.x — Depois da 1.0](https://github.com/mpjbiologo/NeuroTab/milestone/7)
Modo Investigação (#23), mapa de conhecimento (#22), automações visuais (#24), espaços de trabalho (#25), notificações de celular e e-mail (#19, #20), diálogo entre dois modelos de IA (#21), linha do tempo e métricas (#30, #31), widgets de terceiros (#32), versão desktop (#33), perfis independentes para computadores compartilhados (#47) e navegador para Android baseado em Chromium com atualizações pelo GitHub (#42).

## Regras do caminho

- **Uma versão grande pode virar várias pequenas** se crescer demais: é melhor para quem usa e para as revisões das lojas.
- **Permissão nova só com justificativa** pronta para as três lojas (ex.: gravar o áudio de uma aba no modo reunião).
- **Cada atualização** passa nos testes do Chromium e do Firefox antes de ir para as lojas, e entra no [CHANGELOG](../CHANGELOG.md) (que aparece na seção Novidades do site).
- A ordem dentro de cada marco pode mudar conforme o uso e as sugestões nas [Issues](https://github.com/mpjbiologo/NeuroTab/issues).
