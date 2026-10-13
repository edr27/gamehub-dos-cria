# 🎮 GameHub — Hub de Jogos Multiplayer de Navegador

Hub de jogos multiplayer em tempo real para curtir com amigos diretamente no navegador, sem precisar instalar nada!

---

## ⚔️ Novo Jogo Adicionado: **Rinha.io**

**Rinha.io** é um jogo de luta e combate de arena em visão *top-down* com netcode autoritativo a 60 ticks por segundo, predição no cliente e foco em partidas rápidas e eletrizantes entre amigos.

### 🎮 Controles
* **WASD**: Movimentação fluida na arena
* **Mouse**: Mira / direção (o personagem gira com velocidade angular calculada durante ataques)
* **Botão Esquerdo do Mouse (LMB)**: Ataque Leve em arco frontal (Startup 8f -> Ativo 4f -> Recuperação 10f)
* **Botão Direito do Mouse (RMB) / Shift**: Dash com invulnerabilidade temporária (consome Stamina)
* **Barra de Espaço**: Guarda e Parry Perfeito
* **F ou E**: Agarrão (quebra guarda)
* **Q**: Burst / Quebra de Combo (gasta 50% de Momentum)
* **1 a 8**: Emotes rápidos de arena (💬, 🔥, 💀, 👑, ⚡, 🛡️, 😂, 🎯)

---

### 🥋 Mecânicas Centrais de Combate
1. **Compromisso e Janelas de Frame**:
   * Ataques possuem startup (preparação), frames ativos (hitbox) e recuperação. Errar golpes deixa o lutador vulnerável a punições (*whiff punish*).
2. **Triângulo do Neutro**:
   * **Ataque** vence **Agarrão**;
   * **Agarrão** vence **Guarda** (quebra postura instantaneamente se pegar na defesa);
   * **Parry** no tempo certo (janela de 8 frames) vence **Ataque** (zera sua postura e atordoa o atacante);
   * Falhar o tempo de parry deixa em recuperação vulnerável.
3. **Vida + Barra de Postura**:
   * Defender golpes acumula Postura. Ao estourar 100% da postura, ocorre **Quebra de Postura (Stun)**, abrindo a janela para combos livres.
4. **Combos Curtos e Damage Scaling**:
   * Sequências curtas de 3 a 8 golpes (ex: Leve -> Leve -> Pesado ou Leve -> Dash Cancel -> Pesado).
   * Dano diminui a cada golpe adicional (scaling: 100% -> 85% -> 70% -> 55% -> 40%).
   * Limite de fintas de dash cancel (máximo 2 por combo). Sem combos infinitos!
5. **Colisão com Paredes (*Wall-Splat*)**:
   * Empurrar ou arremessar o oponente com knockback contra as bordas da arena causa dano extra de impacto e estende o atordoamento.
6. **Barra de Momentum & Burst**:
   * Enche ao causar e receber dano. Gastar com a tecla `Q` aciona um *Burst* que repele atacantes e quebra combos em andamento.
7. **Lutadores na Versão 1**:
   * **Faísca**: Ágil, 90 HP, lâminas de plasma velozes, dash estendido.
   * **Golias**: Pesado, 125 HP, alto knockback e dano elevado de postura.

---

### 🕹️ Modos de Jogo & Estrutura de Sala
* **1v1 (Rei da Mesa / Melhor de 3)**:
  * 2 jogadores disputam a arena; quem perde vai para o final da fila da sala, o próximo entra como desafiante e os demais assistem em modo espectador fluido em tempo real.
* **Free-For-All (FFA - 3 a 4 jogadores)**:
  * Todos contra todos, o último guerreiro em pé vence a rodada.
* **2v2 em Equipes**:
  * Duelos em duplas organizados pelo host ou balanceados na sala.
* **🏋️ Sala de Treino Offline**:
  * Treine mecânicas contra um boneco dummy configurável (Parado, Atacando, Defendendo).
  * Exibição visual de Hitboxes/Hurtboxes, dados de frame em tempo real e atalho para reset imediato.

---

## ⚙️ Pré-requisitos e Instalação Local

* **Node.js**: Versão 18 ou superior instalada.
* **NPM**: Gerenciador de pacotes padrão do Node.

### 1. Clonar ou Acessar a Pasta do Projeto
```bash
cd d:/HUB
```

### 2. Instalar Dependências
```bash
npm install
```

### 3. Iniciar o Servidor
```bash
npm start
```
Ou em modo de desenvolvimento:
```bash
node server.js
```

O servidor iniciará no endereço:
```
http://localhost:3000
```

---

## 🌐 Variáveis de Ambiente e Portas

| Variável | Descrição | Padrão |
| :--- | :--- | :--- |
| `PORT` | Porta HTTP e WebSocket na qual o servidor escuta | `3000` |
| `NODE_ENV` | Ambiente de execução (`development` ou `production`) | `development` |

Exemplo de execução em outra porta:
```bash
# Windows PowerShell
$env:PORT="8080"; node server.js

# Linux / macOS
PORT=8080 node server.js
```

---

## 👥 Como Testar Multiplayer com Múltiplas Abas

1. Inicie o servidor localmente (`npm start`).
2. Abra o primeiro navegador em `http://localhost:3000`.
3. Digite o nome do jogador (ex: **Jogador 1**) e clique em **Criar Sala**.
4. Copie o código de 5 letras gerado no topo da tela (ex: `PEJDG`).
5. Abra uma segunda janela ou aba (ou aba anônima), acerte o endereço `http://localhost:3000`.
6. Digite o nome do segundo jogador (ex: **Jogador 2**), digite o código da sala e clique em **Entrar**.
7. Na tela da sala, o Host clica no card do jogo **⚔️ Rinha.io**.
8. Ambos escolhem seus lutadores (**Faísca** ou **Golias**) e clicam em **Estou Pronto!**.
9. A contagem regressiva 3.. 2.. 1 inicia e a batalha autoritativa começa!
10. **Simulação de Latência (100–150 ms)**:
    * No Google Chrome / Edge, abra o DevTools (`F12`), vá na aba **Network** (Rede), abra o menu suspenso de **Throttling** e selecione **Fast 3G** ou crie um perfil personalizado com **150ms de latência**.
    * O Rinha.io continuará com resposta imediata para o jogador local graças à predição de cliente e interpolação suave dos adversários.
11. Ao término da partida, clique em **🔄 Revanche com 1 Clique** ou volte ao lobby.

---

## 🚀 Instruções de Deploy (Produção)

O GameHub utiliza **Express + Socket.IO + WebSocket nativo (`ws`)** no mesmo servidor HTTP. Para hospedar o projeto, siga os passos abaixo:

### Opção A: Deploy no Render / Railway (PaaS recomendado)
1. Conecte seu repositório Git ao [Render](https://render.com) ou [Railway](https://railway.app).
2. Configure o serviço como **Web Service**.
3. **Build Command**: `npm install`
4. **Start Command**: `node server.js`
5. **Port**: Não precisa definir manualmente no Render/Railway, a variável `process.env.PORT` é injetada automaticamente pelo provedor.
6. *Nota*: Ambos os provedores suportam WebSockets sem configuração adicional.

### Opção B: Deploy em VPS Linux (Ubuntu + Nginx + PM2)
1. Instale o PM2 e suba o processo:
```bash
npm install -g pm2
pm2 start server.js --name "gamehub"
pm2 save
pm2 startup
```

2. Configuração do **Nginx** como Reverse Proxy com suporte completo a WebSockets (`Upgrade` headers):
```nginx
server {
    listen 80;
    server_name seudominio.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```

---

## 📁 Estrutura de Arquivos do Rinha.io

```
HUB/
├── public/
│   ├── css/
│   │   └── main.css                     # Estilos da interface da arena, lobby e HUD
│   ├── js/
│   │   ├── app.js                       # Hub central e registro de ícones
│   │   └── games/
│   │       └── rinha/
│   │           ├── rinha-config.js      # Balanceamento central (dano, frames, postura, lutadores)
│   │           ├── rinha-engine.js      # Física e simulação pura a 60Hz (compartilhada)
│   │           ├── rinha-renderer.js    # Renderizador Canvas 2D vetorial ultra-leve (<1MB)
│   │           ├── rinha-hud.js         # HUD com barras de HP, postura, momentum, combo e emotes
│   │           ├── rinha-net.js         # Cliente de rede, predição, reconciliação e medição RTT
│   │           ├── rinha-training.js    # Modo treino offline com dummy e frame data
│   │           └── rinha-game.js        # Orquestrador da Rinha, seleção e ciclo de partida
├── server.js                            # Servidor autoritativo 60Hz, WebSocket /ws/rinha e salas
└── README.md                            # Guia de instalação, regras e deploy
```
