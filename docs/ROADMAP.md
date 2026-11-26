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
- ✅ **0.7.6 — Agenda:** agenda própria (próximos, dia, semana, mês, repetição, avisos), Google Agenda, Outlook e iCloud por link, importar/exportar `.ics` e o cérebro respondendo sobre compromissos (#26).
- ✅ **0.7.6.1 — Contas e sincronização:** várias contas Google e sincronização criptografada das notas, atalhos, configurações, agenda e hábitos pelo Google Drive (#27, adiantada da v1.0).
- ✅ **0.7.6.2 — Agenda pela conta Google:** todos os calendários, criar e editar eventos lá (#26). A verificação do Google para tirar o aviso de "app não verificado" está em andamento.
- ✅ **0.7.7 — Área de transferência:** widget com histórico do que você copia, só neste computador: colar no widget, ao copiar em sites e acompanhar tudo o que você copia; pausa, proteção de senhas e códigos, e apagar ao desligar o computador por padrão (#51). Já preparada para compartilhar com outros computadores e o celular numa versão seguinte.
- ✅ **0.7.7.2 — Área de transferência entre aparelhos:** QR code, sua nuvem (Google Drive), ntfy, Telegram e rede local (NeuroTab Ponte), com regras de cada pessoa (#51).
- ✅ **0.7.7.3 — Configurações de cara nova:** categorias na lateral esquerda com sub-abas (11 categorias, 27 páginas), conteúdo ocupando a tela com as opções lado a lado, busca nas configurações e gaveta no celular; os endereços antigos continuam funcionando (#46, adiantada da v1.0).
- ✅ **0.7.7.4 — E-mail:** widget com os e-mails novos das contas conectadas (Gmail e, depois da Microsoft, Outlook), várias contas no mesmo lugar (#20).
- ✅ **0.7.8 — Do seu jeito:** barra de atalhos que se esconde (sempre visível, esconder sozinha ou recolhida com alça; teclado, toque e 📌) (#64); atalhos com formato (bloco, quadrado, círculo, pílula), tamanho, cores, 6 estilos prontos e ícone próprio por atalho (imagem enviada, emoji ou letra), com reserva quando o site não tem ícone (#59); editor visual como sub-aba de Aparência, sobre os três temas: cores, transparência, cantos, sombras, densidade e estilo dos widgets, com prévia, aplicar/cancelar/restaurar, temas salvos e arquivo de tema; e o widget "Como foi hoje?" (humor, energia e uma frase por dia, só no computador) (#58).
- ✅ **0.7.9 — Salvar mídia e rede:** Reels, TikTok, X, YouTube e artigos no cérebro com resumo, pontos-chave, categoria e tags, adaptado do [Kora](https://github.com/Joaovitor12j/kora) (MIT, com créditos) (#67); e widget **Rede**: velocidade, latência, jitter e travadas, o melhor DNS para a sua conexão e alertas e, com a NeuroTab Ponte, ping de verdade, aparelhos no Wi-Fi e programas usando a rede, tudo configurável (#52, adiantada da 1.x). A transcrição do áudio de vídeos sem legenda fica para a 0.8, com o modelo de transcrição da central de IA.
- ✅ **0.7.9.1 — Ícones nítidos:** ícones dos atalhos guardados em 96 px, com a opção de buscá-los em alta resolução no Google ou no DuckDuckGo.
- ✅ **0.7.10 — Sistema:** widget com uso e temperatura do processador e da placa de vídeo, memória, discos, bateria e os programas que mais gastam, com gráficos e alertas; pela NeuroTab Ponte, com temperaturas no Windows pelo LibreHardwareMonitor e só processador e memória pelo navegador quando não há Ponte.
- ✅ **0.7.10.1 — LibreHardwareMonitor mais claro:** o widget diz qual arquivo baixar e como abrir.
- ✅ **0.7.11 — Baixar vídeos da Mídia:** o vídeo dos posts salvos (Instagram, TikTok e X) vai para a pasta Downloads, pelo navegador ou pela NeuroTab Ponte com o yt-dlp e o ffmpeg, usando o login do site quando preciso; configurável em Configurações → Mídia. YouTube fica de fora (regra das lojas).
- ✅ **0.7.11.1 — Apps externos:** página que explica cada programa externo (Ponte, yt-dlp, ffmpeg, LibreHardwareMonitor, Ollama), com o aviso do antivírus; metadados no executável da Ponte para Windows e pedido de assinatura digital gratuita.
- **Depois — Microsoft:** Outlook (agenda e e-mail) e OneDrive (sincronização), com as mesmas contas. Fica para quando o app estiver registrado no Microsoft Entra; ganha o número da versão em que entrar.

### [v0.8 — Assistente de voz e modo reunião](https://github.com/mpjbiologo/NeuroTab/milestone/4) · 4 atualizações
- ✅ **0.8.0 — Primeiro, uma central de IA:** vários provedores, servidores e modelos ao mesmo tempo, com um modelo para cada tarefa (conversa, cérebro, busca por significado, imagens, transcrição, reuniões…), regras claras de prioridade e nenhuma troca silenciosa do computador para a internet (#63, que absorve a #7). A voz da v0.8 precisa disso: um modelo para transcrever e outro para responder.
- ✅ **0.8.1 — Depois, a IA certa para o computador:** "Qual é a melhor IA para o meu computador?" nas Configurações de IA, com o que o navegador detecta, o que a pessoa completa à mão, modelos do Ollama recomendados e o passo a passo para instalar e ligar (#61). É a base da voz local da v0.8.
- ✅ **0.8.2 — Voz que responde:** responder falando ao ser chamado e conversar até 1 minuto de silêncio (#40), com o visual futurista da voz (#39).
- ✅ **0.8.3 — Reunião, conversa e armazenamento:** modo reunião (gravar, transcrever, resumo, pontos importantes e tarefas, botão 📋 perto do microfone) (#41) e modo conversa (microfone sempre ligado e o cérebro responde a tudo, botão 💬) (#44), mais a página de Armazenamento (espaço usado, pastas e limpeza) (#68).

### [v0.9 — Conhecimento e captura](https://github.com/mpjbiologo/NeuroTab/milestone/5) · 5 atualizações (captura primeiro, conhecimento depois)
- ✅ **0.9.0 — Central do botão direito** (#55): o menu entende o contexto e manda o conteúdo ao lugar certo. Reúne salvar trecho como nota, tarefa ou lembrete (#56), captura de imagens e arquivos (#12) e recorte de tela para a biblioteca (#37), mais o Modo Clean (#69), a voz da saudação e as pesquisas em nova aba (#70).
- ✅ **0.9.1 — Finanças pessoais** (#66): entradas e saídas, contas e cartões, contas a pagar, orçamento e importação de extratos e faturas (OFX, CSV e PDF), só no computador e com cofre opcional. O conector de Open Finance por agregador fica para a 1.x (#74).
- ✅ **0.9.2 — Data Hub** (#71): uma camada única de dados externos com cache, limites de uso e fonte e horário em cada dado. BrAPI, Banco Central e HG Brasil (com a chave de cada pessoa) entram como fontes; o widget Cotações vira lista de acompanhamento (ações, FIIs, moedas, cripto, índices e SELIC/CDI/IPCA), com alertas opcionais. O Open-Meteo continua o clima padrão.
- ✅ **0.9.2.1 — Teclado e páginas** (#75): atalhos de teclado editáveis (Sistema → Teclado) e várias páginas de widgets na página inicial.
- ✅ **0.9.2.2 — Layout automático e QR da rede local:** modo ✨ Automático (linhas completas e simétricas), ✨ Organizar no modo livre, e o QR da Ponte apontando para o Wi-Fi certo (sem VPN e adaptadores virtuais), com liberação do Firewall do Windows.
- **0.9.3 — Fontes e documentos:** central de conhecimento com fontes e documentos (#9), adaptador opcional do Open Notebook (#10) e o que falta da #45 (pasta para imagens e áudio; avaliar outros sites, sem contornar DRM nem restrições).
- **0.9.4 — NeuroPilot e Modo Estudante:** sugestões proativas locais (#8) e Modo Estudante (#11), já usando a central de IA da 0.8.0.

### [v1.0 — Estável e completa](https://github.com/mpjbiologo/NeuroTab/milestone/6) · 1 a 2 atualizações
- Painel de privacidade, permissões e fluxo de dados (#28). Já começou: as páginas *Permissões e sites* e *Apps externos* (0.7.11.1) são a base; falta o fluxo de dados por recurso (o que sai, para onde e quando).
- Matriz de testes funcionais para Chrome, Edge e Firefox (#13).
- Revisão geral: textos, acessibilidade, desempenho e documentação.

### [1.x — Depois da 1.0](https://github.com/mpjbiologo/NeuroTab/milestone/7)
Modo Investigação (#23), mapa de conhecimento (#22), automações visuais (#24), espaços de trabalho (#25), notificações de celular (#19), diálogo entre dois modelos de IA (#21), linha do tempo e métricas (#30, #31), widgets de terceiros (#32), versão desktop (#33), perfis independentes para computadores compartilhados (#47), modo múltiplos monitores com um perfil por monitor (#65, junto com #25 e #47, que pedem a mesma base de "configurações por contexto"), conector de Open Finance para as finanças (#74), central de entretenimento por voz (#48) navegador para Android baseado em Chromium com atualizações pelo GitHub (#42) e Saúde da mulher com Modo feminino (#73, formato ainda em estudo).

### [2.x — Plataforma](https://github.com/mpjbiologo/NeuroTab/milestone/8)
A NeuroTab como plataforma: construtor de widgets próprios, privados ou publicados (#72), sobre a API de extensibilidade e o catálogo da #32.

## Regras do caminho

- **Uma versão grande pode virar várias pequenas** se crescer demais: é melhor para quem usa e para as revisões das lojas.
- **Permissão nova só com justificativa** pronta para as três lojas (ex.: gravar o áudio de uma aba no modo reunião).
- **Cada atualização** passa nos testes do Chromium e do Firefox antes de ir para as lojas, e entra no [CHANGELOG](../CHANGELOG.md) (que aparece na seção Novidades do site).
- A ordem dentro de cada marco pode mudar conforme o uso e as sugestões nas [Issues](https://github.com/mpjbiologo/NeuroTab/issues).
