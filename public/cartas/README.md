# 🃏 Cartas Contra a Humanidade (Edição Brasil) 🇧🇷

Minigame completo, jogável e hilário desenvolvido para o **GameHub**, no estilo de festa clássico *"Cards Against Humanity"*, 100% em Português-Brasil com humor politicamente incorreto, ácido, absurdo e referências brasileiras reais.

---

## 🎯 Objetivo do Jogo
Um jogo de **julgamento de humor**:
1. A cada rodada, um jogador é coroado o **Czar**.
2. O Czar sorteia e lê uma **Carta Preta** (pergunta ou frase com lacunas `________`).
3. Os outros jogadores escolhem de sua mão de 10 **Cartas Brancas** a resposta mais absurda e engraçada.
4. O Czar revela as respostas anonimamente, relê com suspense e elege a vencedora (ou a pior, no *Modo Caos*!).
5. O dono da melhor resposta ganha a Carta Preta como ponto.
6. Ao atingir a pontuação ou limite de rodadas configurado, o campeão é consagrado com um título cômico exclusivo.

---

## 📱 Como Jogar (Passa-o-Celular / Mesmo PC)
Projetado especificamente para ser jogado na mesa de amigos usando **um único dispositivo**:
- **3 a 10 jogadores**.
- **Telas de Privacidade**: Quando for a vez de cada jogador escolher sua carta, uma cortina de privacidade protege a tela contra olhares curiosos (`"Passe o celular para [Jogador] - Toque para revelar suas cartas"`).
- **Envio Anônimo**: Todas as submissões são embaralhadas aleatoriamente antes de chegarem ao Czar.
- **Revelação com Suspense**: O Czar toca nas cartas viradas para baixo uma por uma para revelá-las dramaticamente para a mesa antes de declarar o vencedor.

---

## 📦 Baralhos e Expansões Inclusas
O jogo conta com **mais de 150 Cartas Pretas** e **mais de 500 Cartas Brancas**, divididas em 8 expansões ativáveis individualmente:

1. **🃏 Baralho Base**: Humor negro, absurdos do cotidiano e bizarrices universais.
2. **🏛️ Política BR**: Brasília, Lula, Bolsomito, STF, Centrão, corrupção e patriotismo cego.
3. **🔞 Sexo & Safadeza**: Duplo sentido, fetiches inusitados, OnlyFans, motéis de beira de estrada e safadeza sem frescura.
4. **⛪ Religião & Moral**: Pastores milionários, dízimo em 12x, água benta, macumba, julgamento de fofoqueira e pecado.
5. **📺 Nostalgia BR**: Anos 90/2000, Banheira do Gugu, Xuxa, Orkut, lan houses, disk-sexo e funk antigo.
6. **💀 Dark Humor & Existencial**: Boletos vencidos, depressão, CLT 6x1, funerárias e o desespero do capitalismo moderno.
7. **👾 Nerd & Internet**: IA autoconsciente, gamers virgens, criptomoedas, cancelamento no X/Twitter e Reddit.
8. **👵 Família Brasileira**: Tios do pavê, barracos de ceia de Natal, grupos de WhatsApp e herança de terreno na praia.

---

## ⚙️ Regras Especiais e Bônus Divertidos
- **🤖 Rando Cardrissian**: Um bot caótico que joga uma carta branca aleatória toda rodada. Se a carta do bot for a mais engraçada e o Czar escolhê-la, toda a mesa passa vergonha!
- **🌀 Modo Caos**: Inverte o julgamento — o Czar é obrigado a escolher a **pior** carta (a mais sem sentido, tosca ou vergonhosa).
- **😂 House Rules (+1 Ponto de Risada)**: Botão extra para a mesa conceder +1 ponto caso uma jogada tenha feito todos chorarem de rir.
- **⏱️ Timer de Envio (60s)**: Impede que jogadores fiquem 10 minutos analisando cartas.
- **📋 Compartilhar Rodada**: Copia o texto da combinação vencedora pronta para colar no WhatsApp do grupo.
- **🏆 Hall da Fama ("Só os Maiores Sucessos")**: Salva automaticamente no `localStorage` as melhores combinações que venceram partidas.

---

## ✏️ Como Adicionar Cartas Customizadas
O jogo possui um **Editor de Cartas integrado**:
1. Na tela inicial de Setup, clique em **"✏️ Editor de Cartas"**.
2. Escolha entre **Carta Branca (Resposta)** ou **Carta Preta (Pergunta/Lacuna)**.
3. Para cartas pretas com lacunas, utilize `________` (8 sublinhados) onde a resposta deve se encaixar (ex: *"O segredo da felicidade é ________."*).
4. Defina se a carta preta exige 1 ou 2 cartas de resposta (*Pick 1* ou *Pick 2*).
5. Clique em salvar. A carta será salva no `localStorage` e incorporada imediatamente ao baralho!

---

## 🚀 Como Executar Localmente
O minigame roda diretamente na pasta estática do servidor Express do Hub:
```bash
# Na raiz do repositório
npm start
```
Acesse no seu navegador:
- Hub Principal: `http://localhost:3000/`
- Cartas Contra a Humanidade Direto: `http://localhost:3000/cartas/`

---

## 💡 O que falta ou pode ser melhorado futuramente
1. **Modo Multidevice via WebSockets/Socket.IO**: Permitir que cada jogador use seu próprio smartphone enquanto a TV/PC projeta a tela do Czar e da mesa.
2. **Importação/Exportação em massa via CSV/JSON**: Facilitar o compartilhamento de decks personalizados entre grupos de amigos.
3. **Efeitos de Voz TTS (Texto para Fala)**: Uma opção de narrador com voz cômica do robô lendo as cartas pretas e brancas automaticamente.
4. **Votação da Mesa no Czar**: Uma regra opcional onde a mesa pode "vetar" uma escolha ruim do Czar se houver maioria simples.
