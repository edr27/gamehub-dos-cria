# GameHub — contexto do projeto

Hub de jogos multiplayer em tempo real para jogar com amigos no navegador (pt-BR).
Os jogadores criam ou entram em salas por um código de 5 caracteres; o host escolhe o jogo.
Todo texto de interface, comentários e mensagens ao usuário são em português do Brasil.

## Stack e execução

- Node 18+ (CommonJS), Express 5 (serve `/public`), Socket.IO 4 (toda a lógica em tempo real).
- `ws` está importado em `server.js` mas **não é usado**.
- Front-end em JS/CSS puros, sem build e sem framework. Sem banco de dados: todo o estado fica em memória.
- Rodar: `npm start` (`node server.js`). Porta: `PORT` (padrão 3000), bind em `0.0.0.0`.

## Estrutura de arquivos

```
server.js                      Servidor principal (~4.300 linhas): salas, chat, GAME_LIST e gameHandlers de 12 jogos
server/vem-na-mao.js           Servidor autoritativo do Vem na Mão (exporta { createHandler })
server/digite-direito.js       Servidor autoritativo do Digite Direito v4 (exporta { createHandler })
server/death-ball.js           Servidor autoritativo do Death Ball v2 (exporta { createHandler })
data/cartas_cards.json         Baralho: blackCards (364: {id,text,pick}) e whiteCards (1254: {id,text}), textos em MAIÚSCULAS
public/index.html              Página única com 3 telas (home, room, game) e a lista de <script>
public/css/main.css            ~5.000 linhas, estilos globais + uma seção por jogo
public/css/hub.css             Identidade "muro de lambe-lambe": home, lobby, chat, cabeçalho do jogo e toasts
public/css/digite-direito.css  Estilos do Digite Direito v4 (papel, revólver, pistas de corrida, resultados)
public/js/audio.js             Define a const global AudioEngine (Web Audio, sons procedurais)
public/js/app.js               Cliente principal (hub): telas, salas, chat, lobby, window.GameHub
public/js/games/<id>.js        Um arquivo de cliente por jogo (14 arquivos)
public/js/games/deathball/shared.js  Física/constantes do Death Ball, usada pelo servidor (require) e pelo navegador
public/css/death-ball.css      Estilos do Death Ball v2 (HUD, controles de toque, resultados)
public/js/games/vemnamao/shared.js   Constantes, armas, mapas, colisão e passo de movimento do Vem na Mão (servidor + navegador)
public/css/vem-na-mao.css      Estilos do Vem na Mão (HUD de lambe-lambe, minimapa, controles de toque, resultados)
```

Observação: o `server.js` ainda faz `require('./scratch/extracted_cards.json')` como fallback do baralho.
O README menciona o Rinha.io (`public/js/games/rinha/*`, `/ws/rinha`), mas **nada disso existe** em
`server.js`, `index.html` nem em `GAME_LIST`. O jogo não está nesta versão do código.

## Servidor (server.js)

Estado global em memória:

- `rooms: Map<code, room>`
- `playerSockets: Map<socketId, { roomCode, playerName }>`
- `room = { code, hostId, players: Map<socketId, player>, currentGame, gameState, chatHistory, gameInterval }`
- `player = { id, name, score, isHost, connected }` (alguns jogos leem `player.color`, que nunca é definida)

Funções utilitárias: `generateRoomCode()`, `getRoomPlayers()`, `broadcastRoomState(roomCode)`.
`broadcastRoomState` envia `safeGameState(room.gameState)`: cópia sem timers/funções/ciclos. Antes, jogos com
`roundTimer`/`turnTimer` no gameState derrubavam o servidor inteiro (recursão no Socket.IO) num `room:state`.

Eventos cliente → servidor:

| Evento | Quem | Observação |
|---|---|---|
| `room:create {playerName}` | qualquer | callback `{success, code}` |
| `room:join {roomCode, playerName}` | qualquer | máx. 10 jogadores; recusa se já há jogo em andamento |
| `chat:send {text}` | sala | corta em 200 caracteres, histórico de 100 |
| `game:start {gameId}` | host | valida `minPlayers`; chama `handler.start` após 1,5 s |
| `game:action {action, ...}` | sala | repassa para `gameHandlers[currentGame].handleAction` |
| `game:back-to-lobby` | host | limpa `gameInterval`, `gameState.turnTimer`, `gameState.votingTimer` |
| `room:reset-scores` | host | zera `player.score` |

Eventos servidor → cliente: `game-list`, `room:state`, `chat:message`, `chat:history`, `game:starting`,
`game:ended`, `game:error`.

Desconexão: `connected=false`, jogador removido após 30 s, host transferido, sala apagada se esvaziar.
Ganchos opcionais de handler (Death Ball, Digite Direito e Vem na Mão usam): `stop(room)` é chamado em `back-to-lobby`, antes de
um novo `game:start` (revanche) e quando a sala esvazia; `onDisconnect(room, io, roomCode, socketId)` na desconexão.

Pontuação: `player.score` é o ranking geral do hub; `gameState.gameScores[sid]` é o placar da partida.
Depois de pontuar, chamar `broadcastRoomState(roomCode)`.

## Cliente (app.js, index.html, audio.js)

- Telas: `#screen-home`, `#screen-room`, `#screen-game`; trocar com `showScreen('home'|'room'|'game')`.
- Ordem dos scripts no index.html: `socket.io` → `audio.js` → `app.js` → `games/*.js`.
  Cada script tem `?v=N` para cache: **ao editar um arquivo, aumentar o `v` dele**.
- `window.GameHub = { socket, state, DOM, showToast, renderResults, showWaiting, escapeHtml, showScreen, AudioEngine }`.
- Padrão de todo jogo no cliente:

```js
(() => {
  const { socket, DOM } = GameHub;
  socket.on('game:<prefixo>:start', (data) => {
    DOM.gameArea.innerHTML = `...`;           // o jogo desenha tudo em #game-area
    // ... listeners ...
    socket.emit('game:action', { action: '...', ... });
  });
  socket.on('game:<prefixo>:results', (data) => {
    GameHub.renderResults([{ name, rank, detail, points }], extraHtml);  // abre o overlay de resultados
  });
})();
```

- Sempre escapar texto vindo de jogadores com `GameHub.escapeHtml`.
- `renderResults` mostra o overlay; o botão "Voltar ao Lobby" (só host) emite `game:back-to-lobby`.
- Lobby: `renderGamesGrid()` usa `GAME_ICONS[game.id]` (SVG no app.js) ou o emoji do `GAME_LIST`.
  `consenso` e `cartas-contra-humanidade` aparecem destacados.
- Se um item de `GAME_LIST` tiver `externalUrl`, clicar no card navega para essa URL (para qualquer jogador).
  Nada no servidor usa isso hoje.
- Nome do jogador em `localStorage['gh_playerName']`. A História em Cadeia também usa
  `localStorage['gh_historia_profile']` e `['gh_historia_history']`.
- `AudioEngine`: `click, hover, success, error, notification, tap, beat, countdown, gameStart, gameEnd, correct,
  wrong, hit, powerHit, explosion, reveal, tick, drumKick, drumSnare, drumHiHat, drumTom, drumPlay(inst), drumBeat(inst),
  clash, whiff, wallBounce, lockOn, dash, perfectParry, heartbeat`. Instrumentos do Ritmo: `kick, snare, hihat, tom`.

## Identidade visual do hub (hub.css)

Home e lobby são um "muro de lambe-lambe": concreto texturizado com cartazes colados em tinta fluorescente.
Tokens `--lb-*` em `hub.css` (muro `#3a3631`, papel `#efeee9`, tinta `#191714`, rosa `#ff3d8b`, amarelo `#ffd400`,
verde `#19e36b`, azul `#2448ff`); classes de tinta `.ink-pink/yellow/green/blue/paper` definem `--ink-bg/--ink-fg/--ink-over`.
Fonte única **Archivo** variável (Google Fonts): largura 62% nos títulos de cartaz, 100% na interface, 125% no código da sala.
Cada jogo do lobby vira um cartaz (`renderGamesGrid` no app.js: tinta pelo índice, inclinação estável por id,
`LB_FEATURED` ocupa 2 colunas, Enter/Espaço iniciam). Ranking = "lista de chamada" (`renderPlayers`, carimbos `stampAvatar`).
Assinatura: sobreimpressão desalinhada (text-shadow na cor `--ink-over`) só em títulos. Movimento só na abertura da home.
Telas dos jogos: `hub.css` remapeia as variáveis do main.css **dentro de `#screen-game`** (concreto quente, amarelo
`--accent: #ffd400`, Archivo, raios de 2–6 px) e redeclara os aliases legados ali — no `:root` eles já vêm resolvidos.
Jogos novos devem usar essas variáveis em vez de cores soltas. Carregamento = cartaz sendo colado (`game:starting` no app.js);
resultados = "cartaz preto" (`.results-card`, vale para todos os jogos). Ícones em `GAME_ICONS` são carimbos de uma cor
(`currentColor`, furos em `--ico-hole`). Alguns jogos antigos ainda têm cores neon fixas no próprio JS (ex.: Ritmo).

## CSS (main.css)

Paleta "Arena Tática" (zinc + âmbar), tema escuro. Usar as variáveis, nunca cores soltas:

- Superfícies: `--surface`, `--surface-raised`, `--surface-sunken`, `--surface-hover`
- Texto: `--ink`, `--ink-secondary`, `--ink-muted`, `--ink-faint`
- Cores: `--accent` (#f59e0b), `--danger`, `--success`, `--info`; bordas `--border`, `--border-strong`, `--border-accent`
- Aliases legados usados pelos jogos: `--bg-*`, `--text-*`, `--accent-primary/secondary/tertiary/warning/error/success`
- Fontes: `--font-main` (DM Sans), `--font-display` (Outfit)
- Espaçamento: `--gap-xs/sm/md/lg/xl/2xl` (4 a 48 px); raios: `--radius-sm/md/lg/xl/full`
- Classes de uso comum nos jogos: `.game-content`, `.game-instruction`, `.game-emoji-large`, `.btn`,
  `.btn-primary`, `.btn-confirm`, `.btn-ghost`, `.btn-lg`, `.btn-sm`, `.game-number-input`, `.game-slider`,
  `.vote-options`/`.vote-option`, `.tap-button`, `.card`.
- Breakpoints principais: 1200, 950, 820, 768, 380 px. Cada jogo tem sua seção de estilos e `@keyframes` próprios.

## Como adicionar um jogo novo

1. `server.js`: adicionar a entrada em `GAME_LIST` `{ id, name, icon, desc, minPlayers, maxPlayers, color }`.
2. `server.js` (ou módulo em `server/`): `gameHandlers['<id>'] = { start(room, io, roomCode), handleAction(room, io, roomCode, socket, data) }`.
3. Eventos no formato `game:<prefixo>:<evento>`. O prefixo nem sempre é o id (veja a tabela).
4. Timers em `gameState.roundTimer` / `turnTimer` / `votingTimer` (os únicos que o back-to-lobby limpa)
   ou em `room.gameInterval`.
5. Cliente: criar `public/js/games/<id>.js` com o padrão acima e adicionar a `<script>` no `index.html`.
6. Opcional: SVG em `GAME_ICONS` no `app.js`; CSS do jogo no `main.css` (ou arquivo próprio, como o digite-direito).
7. Atualizar o texto "14 jogos" do rodapé da home no `index.html`.

## Jogos

| id | prefixo do evento | Resumo | Ações do cliente |
|---|---|---|---|
| `cronometro-cego` | `cronometro` | Contar 10 s mentalmente; tempo medido no servidor; modo "conversa" sorteado (50%) | `press-start`, `press-stop` |
| `consenso` | `consenso` | 4 rodadas de 35 s; respostas parecidas são agrupadas; rodada 3 "Ovelha Negra"; última vale 2x; unanimidade +25; bots no solo | `answer`, `next-round` |
| `temperatura` | `temperatura` | Palpite em °C (slider -50 a 500) | `guess` |
| `estime` | `estime` | Battle royale de 3 vidas, 30 s, cm/m; pior palpite perde vida; bullseye (≤3%) +25 | `guess`, `next-round` |
| `pesos-medidas` (alias `adivinhe-angulo`) | `angulo` | 5 rodadas; ponteiro visível 2,5 s, depois reproduzir em 15 s | `guess`, `next-round` |
| `ritmo` | `ritmo` | 7 rodadas (níveis 1–7, 4–11 batidas), ouvir 1x e repetir os toques | `submit-taps`, `next-round` |
| `quem-escreveu` | `quem` | 3 rodadas; 60 s escrevendo, depois votação do autor | `answer`, `vote`, `next-round` (mín. 2 jogadores) |
| `historia-cadeia` | `historia` | Uma palavra por turno (20 s), 4 atos, narração por Web Speech API, conquistas e votação de prêmios | `add-word`, `pass`, `react`, `vote`, `play-again` |
| `ia-falsa` | `ia` | Votar qual das 4 "imagens" é real (só descrições, sem imagens) | `vote` |
| `quao-grande` | `grande` | Esticar uma barra até o tamanho real (skins wood/steel/gold/neon), vidas em `room.duelLives` (4) | `guess {value, skin}` |
| `death-ball` | `deathball` | v2 — ver seção abaixo | `ping`, `m`, `parry`, `dash`, `emote`, `profile` |
| `cartas-contra-humanidade` (alias `cartas`) | `cartas` | Czar rotativo, mão de 10, 1 shuffle por jogador, vence quem chegar a 5 | `submit`, `shuffle-hand`, `reveal-card`, `judge`, `next-round` |
| `digite-direito` | `digite` | v4 battle royale — ver seção abaixo (solo tem 3 bots) | `keys {s}` |
| `vem-na-mao` | `vemnamao` | Briga de rua top-down battle royale — ver seção abaixo (solo tem 5 bots) | `ping`, `i {s, t, m}` |

### Digite Direito v4 (server/digite-direito.js + games/digite-direito.js) — battle royale estilo "Final Sentence"

- Ciclos: todos digitam o MESMO texto (frases originais de suspense em `SENTENCES`, juntadas até ~55/85/115/140/160
  caracteres por ciclo) com pavio de `len / (2,45 + 0,25·(ciclo-1)) + 5` s (ritmo máx. 3,8 car/s).
- Revólver por jogador: 6 câmaras, 1 bala secreta (`bullet`), `spent` câmaras gastas. A cada `STRIKE_ERRORS` (4) erros
  puxa o gatilho (cena de 2,6 s travado): chance 1/6, 1/5, 1/4... O 1º lugar do ciclo recarrega o tambor (volta a 1/6).
- Eliminação: quando só resta 1 vivo sem terminar ele é o ÚLTIMO e cai na hora — exceto se a roleta já matou alguém
  no ciclo. Tempo esgotado: quem não terminou puxa o gatilho; se ninguém morreu, cai o de menor progresso.
  Último vivo vence; com 2 vivos é o "Duelo final". Solo: 3 bots (Datilógrafa/Escrivão/Repórter) e a partida
  acaba quando o humano morre. Desconectar = eliminado (`onDisconnect`).
- Servidor autoritativo: o cliente só manda `keys {s}` (lote de caracteres a cada ~25 ms); o servidor confere cada
  um (acentos opcionais via NFD: á = a, ç = c; maiúsculas e pontuação contam), conta erros, gatilhos e chegada.
  Loop de 50 ms em `room.dd` (não em `room.gameState`); progresso `t` a 10 Hz com `volatile`
  (`{left, p: [i,pos,strikeErr,alive,place,chambers,pulling]*}`).
- Eventos s→c: `start, cycle, t, finish, pull, pull-result, timeup, eliminated, cycle-end, gameover`.
- Pontos: 1º 10, 2º 6, 3º 4, demais 2; sobreviver ao gatilho +3; campeão +30 (somados ao `player.score`).
- Cliente: `<textarea>` invisível focado; teclado físico via keydown (1 caractere, sem auto-repeat, evento cancelado
  para não duplicar), teclados virtuais/teclas mortas via `input`/composição; colar bloqueado. Previsão local
  idêntica à regra do servidor. Cursores dos adversários aparecem no texto com a cor de cada um.
- `localStorage`: `gh_dd_best_wpm` (recorde pessoal), `gh_dd_muted`. Diagnóstico: `__digite()` no console.
- Balanceamento validado com simulação headless (`createHandler(...)._tick`): ~2/3 das eliminações por último lugar,
  ~1/3 pela roleta, partidas de ~2 min com 2–7 jogadores.

### Vem na Mão (server/vem-na-mao.js + vemnamao/shared.js + games/vem-na-mao.js) — briga de rua estilo bopz.io

- Top-down, até 8 jogadores, battle royale por rodadas (último de pé; 3 rodadas, ou 2 com 4+ lutadores). Solo: 5 bots
  (Marrento, Zé Pancada, Tia do Chinelo, Gordinho, Mestre Kiko) e a rodada acaba quando o humano cai.
- Triângulo: PORRADA vence AGARRÃO (quem agarra alguém batendo toma "clank", 0,32 s tonto), AGARRÃO vence PARRY e
  parado (segura 0,3 s, mira o arremesso: 16 de dano, empurrão forte; bater na parede = +7 "NA PAREDE"; corpo
  arremessado derruba quem estiver no caminho), PARRY vence PORRADA (janela 0,2 s; quem bateu fica 0,85 s tonto e o
  defensor ganha contra-ataque ×1,6 por 1,2 s; rebate projéteis). Errou parry/agarrão = recuperação vulnerável.
- Dash: 2 cargas (1,35 s cada), 0,11 s de invulnerabilidade, cancela a recuperação dos golpes. Buffer de 0,16 s.
- Armas no chão (pega andando por cima se estiver de mãos vazias; R troca/larga), gastam usos e quebram:
  Chinelo (especial: chinelada que deixa lento), Taco (home run carregado), Peixeira (bote + sangramento),
  Frigideira (panelaço = parry longo que devolve dano), Estilingue (tiro; especial: 3 pedras), Vassoura (alcance;
  especial: varrida 360°), Bombinha (3 bombas com pavio). Mãos: voadora. Coxinha cura 30.
- Mapas 2200×2200 em `MAPS` (A Quebrada: quarteirões e quadra; A Feira: barracas e praça), um por rodada.
  Zona circular que fecha em 4 fases (`ZONE_PHASES`); com poucos jogadores começa mais adiantada (`zone.off`).
  Minimapa mostra todos e setas na borda da tela apontam adversários fora da tela, para os x1 acontecerem.
- Balanceamento/números: tudo em `shared.js` (`C`, `WEAPONS`, `SPECIAL`, `actPlan`). Mudou? Aumente o `?v=` dos dois
  arquivos no index.html. Simulação headless: `createHandler(...)._tick` (bots contra bots).
- Netcode: o cliente manda inputs numerados a 60 Hz (2 por pacote: `i {s: seq, t: relógio do servidor, m: [mx,my,ax,ay,b]*}`),
  botões em bits (`BTN`). O servidor consome **1 input por passo do jogador** (fila vazia = o corpo espera; fila
  acumulada = 2 passos no tick), então a simulação de cada humano anda no ritmo dos inputs dele. O cliente prevê o
  próprio boneco com o mesmo `stepMove` + espelho dos timers de ação (`actPlan/actState`) e, a cada snapshot (30 Hz,
  `volatile`, com `ack` e os timers SEM arredondar), volta ao estado do servidor e reaplica os inputs pendentes;
  o erro restante é suavizado. Adversários interpolados 90 ms no passado. Golpe testa a vítima na posição atual e na
  que o atacante via (até 160 ms). Golpe em humano que não está defendendo fica pendente ~meio ping + 45 ms: um parry
  apertado quando a vítima VIU o golpe chegar (tempo do cliente + 90 ms de interpolação) ainda vale.
- Estado interno em `room.vm`. Eventos s→c: `start, round, live, s, act, hit, parry, grab, throw, clank, splat, dodge,
  dash, proj, projEnd, bomb, boom, wspawn, pick, break, item, eat, kill, roundEnd, gameover, pong`.
- Pontos: nocaute +10, rodada +20, campeão +30 (somados ao `player.score` no `gameover`).
- `localStorage`: `gh_vm_muted`, `gh_vm_games` (esconde a ajuda depois de 3 partidas; H mostra), `gh_vm_profile`.
  Diagnóstico: `__vemnamao()` no console; F3 mostra FPS, seq/ack e correções da previsão.

### Death Ball v2 (server/death-ball.js + deathball/shared.js + games/death-ball.js)

- Jogo: bola teleguiada persegue um alvo; o alvo dá parry no tempo certo e a mira escolhe o próximo alvo.
  Velocidade sobe a cada parry (km/h na tela). Contato sem parry = eliminado. Último vivo vence a rodada;
  primeiro a 3 rodadas (2 se houver 4+ jogadores) vence a partida. Solo: 3 bots (Cypher/Nova/Blaze); no solo,
  a rodada acaba quando o humano morre.
- Mecânicas: janela de parry por tempo-até-impacto (0,42→0,25 s conforme a velocidade), parry perfeito
  (0,10→0,065 s), parry "no limite" (até 40 ms após o contato), errar = 0,62 s sem parry, dash com recarga
  de 2,6 s, Smash (3 perfeitos → próximo parry dá +75% de velocidade que decai), emotes 1–6.
- Tudo que é física/constante fica em `shared.js` (`C`, `stepBall`, `timeToImpact`, `chooseTarget`...).
  Mudou balanceamento? Mude só ali; servidor e cliente usam o mesmo arquivo. Aumente o `?v=` no index.html.
- Servidor: loop de passo fixo 60 Hz (física 120 Hz) com acumulador; snapshot `s` a 30 Hz com
  `volatile.emit` (`{t, b: packBall, p: [i,x,y,ax,ay,alive,ex,ey]*}`); estado interno em `room.db`
  (NÃO em `room.gameState`, que vai no `room:state`). Histórico da bola (~0,66 s) para compensação de lag.
- Netcode: o cliente sincroniza o relógio (`ping`/`pong`), prevê a bola até o "agora" do servidor com a mesma
  física e interpola os adversários 75 ms no passado. O `parry` leva `{t (relógio do servidor), seq, x, y, ax, ay, tti}`;
  o servidor julga no instante `t` (rewind até 260 ms) e aceita o `tti` do cliente se estiver dentro de uma
  tolerância proporcional ao ping. Contato com humano não mata na hora: a bola fica `PENDING` por
  ~meio ping + 55 ms esperando um parry em trânsito. A bola persegue a posição extrapolada do alvo
  (velocidade informada pelo cliente × meio ping), a mesma que o cliente usa. `seq` descarta duplicados.
- Input do cliente: `e.code`, sem auto-repeat, teclas zeradas em blur/aba oculta, um único `pointerdown`
  por botão, botões com `tabindex=-1`, buffer de 130 ms para apertos logo antes do fim da recarga.
- Render: 1 rAF, arena pré-renderizada, brilhos por sprite (sem shadowBlur), pools, HUD em DOM só quando muda,
  qualidade automática (DPR 1 e menos partículas) se o frame médio passar de 23 ms. F3 mostra FPS no HUD.
- Eventos s→c: `start, round, launch, retarget, s, parry, whiff, kill, duel, roundEnd, gameover, dash, emote,
  profile, correct, pong`. Pontos da partida vão para `player.score` no `gameover`.
- XP/nível/recordes ficam só no navegador: `localStorage['gh_deathball_profile']`; som: `['gh_db_muted']`.
- Diagnóstico: `__deathball()` no console devolve o estado do cliente. `createHandler(...)._tick` existe para
  simulação headless (balanceamento de bots).

## Rinha.io

Descrito apenas no README (luta top-down, servidor autoritativo a 60 ticks, WebSocket em `/ws/rinha`).
Não existe código dele nos arquivos analisados. Antes de mexer, confirmar onde ele está.

## Bugs e riscos conhecidos (vindos de leitura de código; nada foi executado)

Servidor, geral:
1. `cronometro-cego` e `temperatura` dão pontos procurando o jogador por **nome** (`p.name === r.name`); nomes repetidos quebram.
2. `player.color` nunca é definida; os fallbacks de cor sempre valem.
3. Rodadas que esperam "todos responderam" usam `players.size`/`playerCount`; jogador desconectado (ainda listado por 30 s) segura a rodada.
4. `room:join` recusa entrada com jogo em andamento.
5. `back-to-lobby` não limpa `ritmoTimers` (jogos com `stop(room)` — Death Ball e Digite Direito — já se limpam).
6. Entradas dos jogadores quase sem validação (limites de palpite, tamanhos de texto). CORS `*` no Socket.IO.
7. `server.js` monolítico, com bancos de perguntas embutidos. `server/digite-direito.js`, `server/death-ball.js` e `server/vem-na-mao.js` são obrigatórios no boot.

Jogos específicos:
8. `ia-falsa`: o cliente usa gradientes/emojis fixos por posição (`['🌄','🐾','🍕','🏙️'][i]`), sem relação com o tema; só 4 temas, resposta correta fixa; sem imagens reais.
9. `quao-grande`: slider de 1 a 10.000, mas há objetos de até 347.400.000 cm; só dá para acertar digitando. Vidas persistem entre partidas, ninguém é eliminado com 0 vidas e não há próxima rodada.
10. `cronometro-cego`: o cliente mostra "10.00 segundos" fixo no resultado (o servidor já envia `targetTime`).
11. `ritmo`: comentário do cabeçalho do cliente diz "5 rodadas / 14 batidas", desatualizado (servidor: 7 rodadas, 4–11 batidas).
12. Contador da sala no `index.html` mostra `/8`, mas o servidor aceita até 10 jogadores.

Digite Direito: os bugs 13–20 da versão antiga foram resolvidos na reescrita v4 (servidor autoritativo, desconexão,
timers parados por `stop`, vencedor sempre definido, pontos somados ao ranking).

## Ainda não analisado

- Conteúdo dos arquivos de cliente de cada jogo além do resumo acima (leitos apenas parcialmente: `death-ball.js`, `historia-cadeia.js`, `cartas.js`, `ritmo.js`, `estime.js`, `consenso.js`, `quem-escreveu.js`, `pesos-medidas.js`, `digite-direito.js`)
- Rinha.io
