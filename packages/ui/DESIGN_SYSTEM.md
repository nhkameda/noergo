# noergo · Design system

Versão 1.0 · 18/10/2026 · Onest + Azul profundo

| Arquivo | Papel | Editar à mão? |
|---|---|---|
| `tokens.json` | fonte da verdade, formato W3C Design Tokens (DTCG) | sim; manter JSON e CSS sincronizados |
| `tokens.css` | os mesmos tokens como variáveis CSS, com tema claro e escuro | sim; manter JSON e CSS sincronizados |
| `contraste.md` | relatório WCAG de todos os pares de cor | sim; manter JSON e CSS sincronizados |
| `noergo.css` | componentes de referência (prefixo `nr-`) | sim |
| `fonts/` | Onest, Figtree e Spline Sans Mono em woff2, com licenças OFL | não |

Este é o pacote final de distribuição. Marca em `../marca/GUIA_DA_MARCA.md`; vitrine navegável em `../site/marca.html`. Os SVGs são as matrizes editáveis. O ambiente de geração e as explorações foram removidos na limpeza solicitada.

---

## 1. Princípios

1. **A cor pertence ao conteúdo.** A moldura da interface fica em Azul profundo e Papel. Ramos, colunas,
   etiquetas e cards levam a cor que a pessoa escolheu.
2. **Círculo é pensamento, retângulo é ação.** Nó, faísca e avatar de pessoa são redondos. Card,
   coluna, botão e campo têm canto suave.
3. **O mesmo objeto viaja entre visões.** Card e nó são a mesma entidade; ao trocar de visão, o
   elemento se move até o novo lugar em vez de sumir e reaparecer.
4. **Teclado em tudo.** Cada ação tem atalho, todo elemento interativo tem foco visível e alvo de pelo
   menos 44 px.
5. **Claro e escuro desde o primeiro dia.** Nenhum componente usa cor fixa: tudo passa pelos tokens
   semânticos, que mudam com o tema.

## 2. Arquitetura dos tokens

```
tokens.json + tokens.css  →  noergo.css  →  componentes do guia
playground-tokens.css    →  landing.css →  página inicial
```

Três camadas:

| Camada | Exemplo | Quem usa |
|---|---|---|
| Paleta bruta | `--nr-anil-500`, `--nr-neutral-600` | só o tema; componente não deve citar |
| Tema semântico | `--nr-accent`, `--nr-text-muted`, `--nr-anil-tint` | componentes e o app |
| Componente | `.nr-btn--primario`, `.nr-card` | telas |

Tema: `:root` e `[data-theme="light"]` são claros; `[data-theme="dark"]` força o escuro; sem atributo,
o escuro segue `prefers-color-scheme`. Com `prefers-reduced-motion: reduce`, todas as durações viram
`0ms`.

Para mudar uma cor, mantenha os valores de `tokens.json` e `tokens.css` sincronizados. As seis cores do símbolo estão em `color.brand` e em `../marca/identidade.json`. As cores semânticas de interface têm valores próprios para preservar o contraste.

## 3. Tokens semânticos

| Token | Claro | Escuro | Para quê |
|---|---|---|---|
| `--nr-canvas` | `#FBFAF7` | `#0F1122` | fundo da página |
| `--nr-surface` | `#FFFFFF` | `#171A2D` | cards, painéis, campo |
| `--nr-surface-sunken` | `#F3F2F0` | `#0B0D1B` | fundo de coluna, áreas recuadas |
| `--nr-raised` | `#FFFFFF` | `#1F2238` | elemento flutuante |
| `--nr-overlay` | `#FFFFFF` | `#272A42` | menu, popover, paleta de comandos |
| `--nr-text` | `#16182D` | `#F2F2F7` | texto principal |
| `--nr-text-muted` | `#575A68` | `#A7A9BA` | texto secundário |
| `--nr-text-subtle` | `#6B6E7B` | `#7E8193` | placeholder, contagem, ícone, meta discreta |
| `--nr-text-inverse` | `#FBFAF7` | `#16182D` | texto sobre `--nr-primary` |
| `--nr-border` | `rgb(22 24 45 / 0.12)` | `rgb(255 255 255 / 0.10)` | borda padrão |
| `--nr-border-strong` | `rgb(22 24 45 / 0.24)` | `rgb(255 255 255 / 0.20)` | borda de campo, contorno de botão |
| `--nr-fill-hover` | `rgb(22 24 45 / 0.05)` | `rgb(255 255 255 / 0.06)` | fundo ao passar o mouse |
| `--nr-fill-active` | `rgb(22 24 45 / 0.09)` | `rgb(255 255 255 / 0.10)` | fundo pressionado |
| `--nr-primary` / `--nr-on-primary` | `#16182D` / `#FBFAF7` | `#FBFAF7` / `#16182D` | botão principal (inverte no escuro) |
| `--nr-on-primary-accent` | `#FFC21A` | `#3057E4` | ação em destaque sobre `--nr-primary`, como o "Desfazer" do aviso |
| `--nr-accent` / `--nr-on-accent` | `#3366FF` / `#FFFFFF` | `#3366FF` / `#FFFFFF` | destaque, seleção |
| `--nr-accent-text` | `#3057E4` | `#91B3FF` | link |
| `--nr-accent-tint` | `#EAF1FE` | `#1B264F` | fundo de item selecionado |
| `--nr-capture` / `--nr-on-capture` | `#FFC21A` / `#16182D` | `#FFC21A` / `#16182D` | botão e foco da captura |
| `--nr-agent` | `#7B5CFA` | `#9688FF` | traço, tracejado e ponto de agente de IA |
| `--nr-agent-fill` | `#6E4DDE` | `#6E4DDE` | superfície de agente com texto branco (avatar, botão) |
| `--nr-agent-text` / `--nr-agent-tint` | `#603CC0` / `#F0EFFE` | `#B2ADFF` / `#292652` | texto e fundo de sugestão |
| `--nr-success` / `-text` / `-tint` | `#08A55C` / `#056B3A` / `#E0FCE8` | `#68D08F` / `#94DFAC` / `#183437` | feito, salvo |
| `--nr-warning` / `-text` / `-tint` | `#FF8A26` / `#974001` / `#FFF2EA` | `#FEAA6F` / `#FFC39C` / `#3C2C2C` | prazo próximo |
| `--nr-danger` / `-text` / `-tint` | `#CD3935` / `#B0282E` / `#FFEDEA` | `#F77868` / `#FFA193` / `#3D222F` | erro: ícone, texto, fundo de alerta |
| `--nr-danger-fill` | `#CD3935` | `#CD3935` | botão de apagar, com texto branco |
| `--nr-focus` | `#3366FF` | `#6391FF` | anel de foco |
| `--nr-selection` | `rgb(51 102 255 / 0.18)` | `rgb(99 145 255 / 0.28)` | seleção de texto e de nós |
| `--nr-grid-dot` | `rgb(22 24 45 / 0.10)` | `rgb(255 255 255 / 0.08)` | pontos do fundo do mapa |

Regra das superfícies com texto branco: agente usa `--nr-agent-fill` e perigo usa `--nr-danger-fill`,
as duas iguais nos dois temas. `--nr-agent` e `--nr-danger` ficam para traço, ponto, ícone e texto, e
clareiam no escuro para aparecer sobre o fundo.

Bordas e preenchimentos usam Azul profundo com transparência, não cinza sólido. Assim eles se ajustam ao
calor do Papel e a qualquer superfície por baixo.

## 4. Cores de conteúdo

Oito cores para colunas, ramos, etiquetas e cards. Cada uma vem em quatro tokens por tema:

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--nr-{cor}` | tom 500 | tom 400 | ponto, faixa lateral do card, nó cheio |
| `--nr-{cor}-tint` | tom 100 | 24% da cor sobre a superfície escura | fundo de card e de etiqueta |
| `--nr-{cor}-ink` | tom 800 | tom 200 | texto sobre o tint |
| `--nr-{cor}-edge` | tom 500 | tom 400 | ligação no mapa |

| Cor | Papel fixo | 500 | tint claro | ink claro | tint escuro | ink escuro |
|---|---|---|---|---|---|---|
| `faisca` | captura, a ideia | `#FFC21A` | `#FFF1D6` | `#8D6001` | `#4F4228` | `#FFE8BA` |
| `tangerina` | energia, prazo | `#FF8A26` | `#FFE9DB` | `#974001` | `#4F352B` | `#FED7BF` |
| `urucum` | erro, apagar | `#E8483A` | `#FEDFDA` | `#921626` | `#492530` | `#FEC3B9` |
| `goiaba` | afeto, prioridade | `#FF5A8A` | `#FFE3E7` | `#972157` | `#4F2943` | `#FFCBD5` |
| `uva` | agentes de IA | `#7B5CFA` | `#E3E2FE` | `#502CA1` | `#2F2A5E` | `#CBC9FE` |
| `anil` | interação, links | `#3366FF` | `#D8E4FE` | `#2635A9` | `#1E2C5F` | `#B6CDFE` |
| `lagoa` | referência | `#17B3D1` | `#D0F2FC` | `#076375` | `#173F54` | `#B3E6F3` |
| `broto` | feito, progresso | `#1FBF6E` | `#D1F7DC` | `#056B3A` | `#19423D` | `#B5ECC5` |

Uva, Anil, Broto, Urucum e Faísca têm papel fixo na interface. A pessoa pode usar qualquer uma das oito
nas próprias colunas; a interface não usa essas cinco fora do papel delas.

**Como aplicar:** coloque `data-cor="…"` no elemento. O CSS define quatro variáveis locais, e os
componentes leem só elas:

```html
<article class="nr-card" data-cor="goiaba">…</article>
<!-- dentro do componente: --c, --c-tint, --c-ink, --c-edge -->
```

Sem `data-cor`, os componentes caem num neutro (`--nr-border-strong` ou `--nr-text-subtle`).

**Escalas completas** (50 a 900): `--nr-{cor}-{passo}` em `tokens.css`. Neutros:
`--nr-neutral-{0,25,50,100,150,200,300,400,500,600,700,800,850,900,950}`, levemente frios (matiz 276).
Fixos: `--nr-nanquim` `#16182D`, `--nr-papel` `#FBFAF7`, `--nr-branco` `#FFFFFF`.

## 5. Tipografia

| Token | Valor |
|---|---|
| `--nr-font-display` | Onest, com Figtree e `ui-rounded` de reserva |
| `--nr-font-ui` | Figtree, com `system-ui` de reserva |
| `--nr-font-mono` | Spline Sans Mono, com `ui-monospace` de reserva |

| Token | px | rem | Uso típico |
|---|---|---|---|
| `--nr-text-xs` | 12 | 0.75 | meta de card, etiqueta (menor tamanho permitido) |
| `--nr-text-sm` | 13 | 0.8125 | botão pequeno, rótulo de campo |
| `--nr-text-md` | 14 | 0.875 | corpo da interface, título de card, botão |
| `--nr-text-base` | 16 | 1 | texto corrido |
| `--nr-text-lg` | 18 | 1.125 | barra de captura |
| `--nr-text-xl` | 20 | 1.25 | lead, título de estado vazio |
| `--nr-text-2xl` | 24 | 1.5 | `.nr-h3` |
| `--nr-text-3xl` | 30 | 1.875 | |
| `--nr-text-4xl` | 38 | 2.375 | `.nr-h2` |
| `--nr-text-5xl` | 48 | 3 | `.nr-h1` |
| `--nr-text-6xl` a `8xl` | 60, 76, 96 | 3.75, 4.75, 6 | display do site |

| Grupo | Tokens |
|---|---|
| Peso | `regular` 400, `medium` 500, `semibold` 600, `bold` 700, `black` 800 |
| Entrelinha | `tight` 1,04; `snug` 1,18; `normal` 1,45; `relaxed` 1,6 |
| Espaçamento | `display` −0,035 em; `heading` −0,02 em; `ui` 0; `caps` 0,08 em (para `.nr-eyebrow`) |

Classes prontas: `.nr-display`, `.nr-h1`, `.nr-h2`, `.nr-h3`, `.nr-lead`, `.nr-eyebrow`, `.nr-mono`.
Onest oferece pesos de 100 a 900. A assinatura oficial usa 700; os títulos da interface usam 700–800.

## 6. Espaço, raio e camadas

Espaço em base 4 px, nomeado em múltiplos de 4 (`--nr-space-4` = 16 px):

| Token | 0 | 0-5 | 1 | 1-5 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16 | 20 | 24 | 32 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| px | 0 | 2 | 4 | 6 | 8 | 12 | 16 | 20 | 24 | 32 | 40 | 48 | 64 | 80 | 96 | 128 |

| Raio | px | Onde |
|---|---|---|
| `--nr-radius-xs` | 4 | tecla (`.nr-kbd`) |
| `--nr-radius-sm` | 6 | detalhe, anel de foco |
| `--nr-radius-md` | 10 | card, campo |
| `--nr-radius-lg` | 14 | coluna, aviso |
| `--nr-radius-xl` | 20 | barra de captura, estado vazio, painel |
| `--nr-radius-2xl` | 28 | moldura grande do site |
| `--nr-radius-full` | 999 | botão, nó, etiqueta, seletor de visão |

Camadas (`--nr-z-*`): `base` 0, `raised` 10, `sticky` 100, `dropdown` 1000, `overlay` 1100, `modal`
1200, `toast` 1300, `tooltip` 1400.

Layout (`--nr-layout-*`): barra lateral 264 px, barra superior 56 px, coluna do quadro 288 px,
conteúdo máximo 1200 px.

## 7. Sombra

| Token | Claro | Uso |
|---|---|---|
| `--nr-shadow-1` | `0 1px 2px` + `0 1px 1px`, Azul profundo a 6% e 4% | card em repouso, nó |
| `--nr-shadow-2` | `0 2px 4px` + `0 8px 20px`, Azul profundo a 5% e 7% | hover, barra de captura |
| `--nr-shadow-3` | `0 12px 28px` + `0 28px 64px`, Azul profundo a 10% e 12% | aviso, menu, modal |
| `--nr-shadow-lift` | `0 18px 40px` + `0 4px 10px`, Azul profundo a 18% e 8% | card sendo arrastado |

No escuro as sombras usam preto entre 30% e 55%: sombra tingida de Azul profundo some sobre fundo Azul profundo.

## 8. Movimento

| Duração | Valor | Uso |
|---|---|---|
| `--nr-dur-instant` | 90 ms | troca de cor de ícone |
| `--nr-dur-fast` | 140 ms | hover e pressão de botão |
| `--nr-dur-base` | 220 ms | card subindo no hover, foco da captura |
| `--nr-dur-slow` | 360 ms | elemento surgindo (`.nr-surgir`) |
| `--nr-dur-morph` | 560 ms | card viajando entre visões |

| Curva | Valor | Quando |
|---|---|---|
| `--nr-ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | padrão: entrar, mover, abrir |
| `--nr-ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | ida e volta entre dois estados |
| `--nr-ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | **só** para nascer: card criado, nó novo, aviso chegando |
| `--nr-ease-emphasized` | `cubic-bezier(0.2, 0, 0, 1)` | troca de visão (FLIP do mapa para o quadro) |

A mola passa do ponto e volta. Num card criado isso é alegria; num menu que abre dez vezes por minuto,
cansa. Por isso ela fica restrita a nascimentos.

## 9. Grafo

| Token | Valor | Uso |
|---|---|---|
| `--nr-edge-width` | 2 px | ligação comum |
| `--nr-edge-width-strong` | 3 px | ligação selecionada ou do ramo principal |
| `--nr-node-min-height` | 36 px | altura mínima de nó |
| `--nr-handle-size` | 10 px | alça de ligação em volta do nó |
| `--nr-grid-gap` | 24 px | espaçamento dos pontos de `.nr-tela` |

Ligações sempre com `stroke-linecap: round`, na cor `--c-edge` do ramo. Sugestão de agente: pontilhado
`2 6` em `--nr-agent`.

## 10. Componentes

Inclua `tokens.css` e depois `noergo.css`. Aplique `.nr-base` no `body` (ou num contêiner) para
fundo, fonte, foco e seleção.

### Botão · `.nr-btn`

| Variante | Classe | Uso |
|---|---|---|
| Principal | `.nr-btn--primario` | uma ação principal por tela; Azul profundo no claro, Papel no escuro |
| Captura | `.nr-btn--captura` | guardar uma ideia; Faísca com texto Azul profundo |
| Destaque | `.nr-btn--destaque` | confirmar seleção, aceitar; Anil com texto branco |
| Fantasma | `.nr-btn--fantasma` | ação secundária; contorno `--nr-border-strong` |
| Perigo | `.nr-btn--perigo` | apagar; `--nr-danger-fill` (Urucum 600) com texto branco nos dois temas |
| Tamanhos | `.nr-btn--sm` (36 px), padrão (44 px), `.nr-btn--lg` (54 px) | |

```html
<button class="nr-btn nr-btn--captura">Guardar ideia</button>
<button class="nr-btn nr-btn--fantasma nr-btn--sm">Cancelar</button>
```

Desabilitado: atributo `disabled` ou `aria-disabled="true"` (opacidade 45%, sem movimento).

### Tecla · `.nr-kbd`

```html
<span class="nr-kbd">⌘</span><span class="nr-kbd">K</span>
```

### Barra de captura · `.nr-captura`

```html
<label class="nr-captura">
  <span class="nr-captura__faisca" aria-hidden="true"></span>
  <input type="text" placeholder="Tive uma ideia…" aria-label="Anotar ideia">
  <span class="nr-kbd">⌘</span><span class="nr-kbd">K</span>
  <button class="nr-btn nr-btn--captura">Guardar</button>
</label>
```

Ao receber foco, a borda vira Faísca com halo de 4 px. A faísca pode pulsar com a animação `nr-faisca`
enquanto o campo está vazio.

### Campo · `.nr-campo`

```html
<div class="nr-campo">
  <label for="email">E-mail</label>
  <input id="email" type="email">
  <small>A gente só escreve quando abrir sua vaga.</small>
</div>
```

### Etiqueta · `.nr-tag`

```html
<span class="nr-tag" data-cor="broto">Feito</span>
<span class="nr-tag nr-tag--sem-ponto" data-cor="anil">#podcast</span>
```

### Card · `.nr-card`

| Variante | Classe | Aparência |
|---|---|---|
| Padrão | `.nr-card` | superfície branca, faixa lateral de 4 px na cor |
| Tinta | `.nr-card--tinta` | fundo tint, texto ink, sem faixa |
| Erguido | `.nr-card--erguido` | inclinado −2°, sombra `lift`; estado de arrasto |
| Feito | `.nr-card--feito` | título riscado em `--nr-success` |

```html
<article class="nr-card" data-cor="anil">
  <div class="nr-card__titulo">Pauta dos 5 primeiros episódios</div>
  <div class="nr-card__meta"><span class="nr-tag" data-cor="anil">Ideia</span> 3 ligações</div>
</article>
```

### Sugestão de agente · `.nr-sugestao`

Combine com `.nr-card`. Borda tracejada e fundo em Uva; a pessoa decide.

```html
<article class="nr-card nr-sugestao">
  <div class="nr-card__titulo">Pesquisar hospedagem de podcast</div>
  <div class="nr-card__meta"><span class="nr-avatar nr-avatar--agente">…</span> sugerido pelo Claude</div>
  <div class="nr-sugestao__acoes">
    <button class="nr-btn nr-btn--destaque nr-btn--sm">Aceitar</button>
    <button class="nr-btn nr-btn--fantasma nr-btn--sm">Descartar</button>
  </div>
</article>
```

### Coluna · `.nr-coluna`

```html
<section class="nr-coluna" data-cor="faisca">
  <header class="nr-coluna__cabeca">Ideias <span class="nr-coluna__conta">4</span></header>
  <article class="nr-card" data-cor="faisca">…</article>
</section>
```

Largura padrão `--nr-layout-column` (288 px); o ponto do cabeçalho leva a cor da coluna.

### Nó e ligação · `.nr-no`, `.nr-ligacao`

| Variante | Classe | Uso |
|---|---|---|
| Padrão | `.nr-no` | pílula branca com borda de 2 px e ponto na cor |
| Raiz | `.nr-no--raiz` | centro do mapa; fundo `--nr-primary`, ponto Faísca, Onest |
| Cheio | `.nr-no--cheio` | fundo na cor viva, texto Azul profundo |
| Sugestão | `.nr-no--sugestao` | tracejado em Uva |

```html
<div class="nr-tela">
  <svg><path class="nr-ligacao" data-cor="goiaba" d="M0 0C40 0 40 60 80 60"/></svg>
  <span class="nr-no nr-no--raiz">Lançar o podcast</span>
  <span class="nr-no" data-cor="goiaba">Convidar a Dona Cida</span>
</div>
```

`.nr-ligacao--sugestao` deixa a ligação pontilhada em Uva.

### Avatar · `.nr-avatar`

O avatar de agente usa `--nr-agent-fill` (Uva 600) com ícone branco, 5,56:1 nos dois temas.

```html
<span class="nr-avatar" data-cor="goiaba">CS</span>           <!-- pessoa: círculo -->
<span class="nr-avatar nr-avatar--agente"><svg>…</svg></span>  <!-- agente: canto suave, Uva -->
<div class="nr-avatares">…</div>                              <!-- grupo sobreposto -->
```

A forma diferencia pessoa de agente mesmo para quem não distingue cores.

### Seletor de visão · `.nr-visoes`

```html
<div class="nr-visoes" role="group" aria-label="Visão">
  <button aria-pressed="true">Mapa</button>
  <button aria-pressed="false">Quadro</button>
  <button aria-pressed="false">Lista</button>
</div>
```

Aceita `aria-pressed` (botões) ou `aria-selected` (abas com `role="tab"`).

### Aviso · `.nr-aviso`

```html
<div class="nr-aviso" role="status">  <!-- o botão usa --nr-on-primary-accent -->
  <span class="nr-aviso__ponto"></span> Feito. Movi 3 cards para Fazendo.
  <button>Desfazer</button>
</div>
```

### Estado vazio · `.nr-vazio`

```html
<div class="nr-vazio">
  <strong>Nada por aqui ainda.</strong>
  Que tal anotar a primeira ideia?
  <button class="nr-btn nr-btn--captura">Anotar</button>
</div>
```

### Tela pontilhada · `.nr-tela`

Fundo do mapa: pontos de 1,2 px a cada 24 px em `--nr-grid-dot`, sobre `--nr-surface`.

### Movimento utilitário

`.nr-surgir` aplica a entrada com mola (360 ms). Os `@keyframes` `nr-surgir` e `nr-faisca` ficam
disponíveis para o app.

## 11. Acessibilidade

**Contraste** (valores de `contraste.md`, critério AA de 4,5:1 para texto normal):

| Par | Contraste |
|---|---|
| Texto Azul profundo sobre Papel | 16,73:1 |
| Texto secundário (`text-muted`) sobre Papel | 6,56:1 |
| Texto sutil (`text-subtle`) sobre Papel / sobre `surface-sunken` | 4,86:1 / 4,53:1 |
| Link Anil 600 sobre Papel | 5,57:1 |
| Branco sobre Anil 500 | 4,68:1 |
| Azul profundo sobre Faísca | 10,80:1 |
| Ação do aviso: Faísca sobre Azul profundo (claro) / Anil 600 sobre Papel (escuro) | 10,80:1 / 5,57:1 |
| Branco sobre `agent-fill` (Uva 600), nos dois temas | 5,56:1 |
| Branco sobre `danger-fill` (Urucum 600), nos dois temas | 4,96:1 |
| Texto de agente sobre tint de agente | 6,36:1 |
| Ink sobre tint, oito cores, claro | de 4,94:1 (Faísca) a 7,60:1 (Anil) |
| Ink sobre tint, oito cores, escuro | de 8,17:1 a 8,63:1 |
| Escuro: texto sobre canvas | 16,75:1 |
| Escuro: texto sutil sobre canvas | 4,85:1 |

Todos os pares de texto da tabela passam no AA. Uva 500 com texto branco dá 4,42:1 e não passa; por
isso existe `--nr-agent-fill`.

**Foco:** `.nr-base :focus-visible` desenha anel de 2 px em `--nr-focus`, afastado 2 px. Não remova
sem pôr outro no lugar.

**Alvos:** botões e itens do seletor têm altura mínima de 44 px (36 px em `.nr-btn--sm` e no seletor
de visão, usados só em barra de ferramentas densa com espaço em volta).

**Movimento:** `prefers-reduced-motion: reduce` zera todas as durações e desliga `.nr-surgir` e as
transições de botão e card.

**Fonte mínima:** 12 px (`--nr-text-xs`). Não existe token menor de propósito.

## 12. Ícones

- Traço de 2 px numa grade de 24, terminais e junções redondos, sem preenchimento. É o mesmo desenho
  das ligações e do logotipo.
- **Lucide** segue essa regra e pode servir de base (licença ISC). Ícone próprio do noergo segue a
  mesma grade.
- Tamanhos: 16 px dentro de botão e seletor, 20 px em barra de ferramentas, 24 px isolado.
- Cor: `currentColor`. Ícone colorido só quando representa conteúdo (o ponto de uma coluna, por
  exemplo).

## 13. Como usar no app

**CSS direto**

```html
<link rel="stylesheet" href="design-system/tokens.css">
<link rel="stylesheet" href="design-system/noergo.css">
<body class="nr-base">…</body>
```

`noergo.css` carrega as fontes por caminho relativo (`fonts/…`): mantenha a pasta `fonts/` ao lado.
Para trocar o tema, ponha `data-theme="dark"` ou `"light"` no `<html>`.

**Com build (Tailwind, Style Dictionary, Panda)**

- Leia `tokens.json`. O formato é DTCG: cada folha tem `$value` e `$type`.
- `color.*` traz as escalas; `theme.light` e `theme.dark` trazem os semânticos já resolvidos em hex
  ou `rgb()`.
- No Tailwind, aponte as cores para as variáveis (`accent: 'var(--nr-accent)'`) em vez dos hex: assim
  o tema escuro continua funcionando sem classe `dark:` em cada componente.

**Regras para quem escreve código**

1. Nenhuma cor solta no código. Se falta um token, registre-o em `tokens.json` e `tokens.css`.
2. Componente usa só token semântico ou as variáveis locais `--c*`; nunca `--nr-anil-500` direto.
3. Roxo (Uva) é exclusivo de agente de IA.
4. Texto nunca abaixo de 12 px.
5. Toda animação nova usa um token de duração, para respeitar "reduzir movimento".

## Identidade aprovada

Nome em Onest 700, azul profundo #142B45, sobre papel #F7F5EF. As seis cores do cérebro são de marca, não estados semânticos. Os aliases `--nr-nanquim` e os nomes de arquivo `*-nanquim` foram mantidos por compatibilidade e agora usam #142B45.

A landing usa Onest nos títulos, Figtree nos textos, --pg-ink #142B45 e suas cores de ação já estabelecidas. Mantenha os arquivos de `site/assets/ds/` iguais aos desta pasta ao editar.
