# Caminho até a 1.0

Cada versão grande é um marco no GitHub, com as issues que entram nela. As versões grandes saem em atualizações menores (0.7.0, 0.7.1…) para as revisões das lojas serem rápidas. Estimativa: **16 a 18 atualizações** até a 1.0 (a contar da 0.7.0); 9 já saíram.

## O que a 1.0 promete

A 1.0 não é "ter todos os recursos". É poder dizer: **pode confiar seus dados à NeuroTab**.

- **Seus dados vão com você:** sincronização opcional e criptografada entre computadores.
- **Transparência:** um painel mostra o que sai do computador, para onde e por quê.
- **Base estável:** módulos com contratos claros, que crescem sem quebrar o resto.
- **Sem surpresas por navegador:** Chrome, Edge e Firefox passam pela mesma lista de testes a cada versão.

## Marcos

### [v0.7 — Base modular e painel](https://github.com/mpjbiologo/NeuroTab/milestone/3) · 9 atualizações
Primeiro a base, depois os recursos.
- ✅ **0.7.0 — Arquitetura modular:** `newtab.js` dividido em módulos (#14); botões flutuantes sem cobrir widgets (#38).
- ✅ **0.7.1:** barramento de eventos (#5) e contrato dos widgets (#6); o cérebro lê o widget de mapas (#43); maximizar, minimizar e restaurar widgets (#18).
- ✅ **0.7.2 — Assistente com nome e janelas organizadas:** nome do assistente, frase de ativação composta ("Acorde Verônica"), sinal sonoro e estados da escuta (#15); camadas centralizadas e nenhum painel fora da tela ou sobreposto sem querer (#35).
  - ✅ 0.7.2.1 a 0.7.2.3: rotas e trânsito ao vivo dentro do widget Trânsito, favoritos salvos ali (#43).
- ✅ **0.7.3 — Voz local:** voz transcrita no próprio computador (reconhecimento local do navegador ou Whisper local, com o Ollama respondendo) e modo "somente local" (#49); janelas lembram o estado, maximizado incluído (#50).
- ✅ **0.7.4 — Novo visual:** sistema de design com três temas (Futurista, Sóbria, Calorosa), ícones desenhados, acessibilidade e o site no mesmo visual (#53).
- ✅ **0.7.5 — O cérebro lê as imagens:** texto das imagens lido no computador e imagens no cérebro (#17); "Analisar imagem" e "Traçar rota" no botão direito (#54); o Enter da barra de pesquisa faz o que a pessoa escolher (#57).
- ✅ **0.7.5.2 / 0.7.5.3 — Aba Mídia:** guardar ou não a imagem analisada e IA própria para imagens (a 0.7.5.3 leva às lojas a 0.7.5.2, que não chegou a ser enviada).
- ✅ **0.7.5.1 — Correções:** a barra de organizar não fica mais atrás dos widgets (#60); a descrição de imagens só usa modelos que enxergam.
- **0.7.6 — Agenda:** agenda própria (dia, semana, mês, recorrência), importação de `.ics` e o cérebro respondendo sobre compromissos; contas Google/Microsoft numa etapa seguinte (#26).
- **0.7.7 — Do seu jeito:** atalhos com formato (redondo, quadrado, arredondado), cor e ícone próprios, favicon automático com recarga e envio de ícone (#59); editor visual da aparência em Configurações → Aparência, construído sobre os três temas: cores, transparência, cantos, estilo dos widgets, prévia, restaurar padrão e exportar/importar tema (#58).

### [v0.8 — Assistente de voz e modo reunião](https://github.com/mpjbiologo/NeuroTab/milestone/4) · 4 atualizações
- **Primeiro, uma central de IA:** vários provedores, servidores e modelos ao mesmo tempo, com um modelo para cada tarefa (conversa, cérebro, busca por significado, imagens, transcrição, reuniões…), regras claras de prioridade e nenhuma troca silenciosa do computador para a internet (#63, que absorve a #7). A voz da v0.8 precisa disso: um modelo para transcrever e outro para responder.
- **Depois, a IA certa para o computador:** "Qual é a melhor IA para o meu computador?" nas Configurações de IA, com o que o navegador detecta, o que a pessoa completa à mão, modelos do Ollama recomendados e o passo a passo para instalar e ligar (#61). É a base da voz local da v0.8.
- Responder falando ao ser chamado e conversar até 1 minuto de silêncio (#40).
- Modo reunião: gravar, transcrever, resumo, pontos importantes e tarefas, com botão 📋 perto do microfone (#41).
- Modo conversa: microfone sempre ligado e o cérebro responde a tudo, com botão 💬 perto do microfone (#44).
- Visual futurista da voz (#39).

### [v0.9 — Conhecimento e captura](https://github.com/mpjbiologo/NeuroTab/milestone/5) · 3 atualizações (captura primeiro, conhecimento depois)
- **Central de ações do botão direito** (#55): o menu entende o contexto e manda o conteúdo ao lugar certo. Reúne salvar trecho como nota, tarefa ou lembrete (#56), captura de imagens e arquivos (#12), recorte de tela para a biblioteca (#37) e a área de transferência (#51).
- Separar provedores, embeddings e tarefas de IA (#7), base para o resto.
- NeuroPilot: sugestões proativas locais (#8).
- Central de conhecimento: fontes e documentos (#9) e adaptador opcional do Open Notebook (#10).
- Modo Estudante (#11).
- Escolher a pasta das mídias e avaliar downloads de áudio e vídeo de sites, sem contornar DRM nem restrições (#45).

### [v1.0 — Estável e completa](https://github.com/mpjbiologo/NeuroTab/milestone/6) · 1 a 2 atualizações
- Sincronização opcional e criptografada entre dispositivos (#27).
- Painel de privacidade, permissões e fluxo de dados (#28).
- Matriz de testes funcionais para Chrome, Edge e Firefox (#13).
- Configurações: reorganizar as abas e agrupar as permissões; o visual novo já saiu na 0.7.4 (#46).
- Revisão geral: textos, acessibilidade, desempenho e documentação.

### [1.x — Depois da 1.0](https://github.com/mpjbiologo/NeuroTab/milestone/7)
Modo Investigação (#23), mapa de conhecimento (#22), automações visuais (#24), espaços de trabalho (#25), notificações de celular e e-mail (#19, #20), diálogo entre dois modelos de IA (#21), linha do tempo e métricas (#30, #31), widgets de terceiros (#32), versão desktop (#33), perfis independentes para computadores compartilhados (#47), widget de velocidade da internet e ping (#52), central de entretenimento por voz (#48) e navegador para Android baseado em Chromium com atualizações pelo GitHub (#42).

## Regras do caminho

- **Uma versão grande pode virar várias pequenas** se crescer demais: é melhor para quem usa e para as revisões das lojas.
- **Permissão nova só com justificativa** pronta para as três lojas (ex.: gravar o áudio de uma aba no modo reunião).
- **Cada atualização** passa nos testes do Chromium e do Firefox antes de ir para as lojas, e entra no [CHANGELOG](../CHANGELOG.md) (que aparece na seção Novidades do site).
- A ordem dentro de cada marco pode mudar conforme o uso e as sugestões nas [Issues](https://github.com/mpjbiologo/NeuroTab/issues).
