# Noergo — identidade visual definitiva

Versão 1.0 · 18/10/2026

A identidade escolhida combina o cérebro **Mente modular (05)**, a assinatura **Onest 700 (A5)** e o **azul profundo #142B45 (B3)**. A imaginação ganha forma em seis peças coloridas, caminhos e pontos de encontro.

## Assinatura

O nome é escrito em minúsculas no logotipo. A fonte real Onest, peso 700, foi convertida em contornos com espaçamento ajustado. Use os SVGs fornecidos; não recomponha a assinatura digitando o nome. Em texto corrido, “Noergo” é permitido.

O cérebro foi redesenhado em curvas vetoriais a partir do conceito escolhido. As cores são sólidas, sem sombras ou gradientes. Os SVGs finais não incorporam imagens raster nem dependem de fontes instaladas.

## Cores

| Uso | Cor |
|---|---|
| Nome, versão de uma cor e fundo do ícone | Azul profundo `#142B45` |
| Fundo preferencial | Papel `#F7F5EF` |
| Caminhos internos e nome negativo | Branco `#FFFFFF` |
| Peça superior esquerda | Azul `#0061FF` |
| Peça superior direita | Amarelo `#FFD000` |
| Peça central esquerda | Verde `#53C51B` |
| Peça central direita | Ciano `#00A1F1` |
| Peça inferior esquerda | Vermelho `#FF3025` |
| Peça inferior direita | Turquesa `#00B990` |

As cores vivas pertencem ao símbolo. Para textos, botões e estados, use os tokens semânticos do design system; uma cor adequada ao logo não é necessariamente adequada a texto pequeno.

## Versões

| Arquivo em svg/ | Aplicação |
|---|---|
| noergo-horizontal.svg | Assinatura principal em fundo claro |
| noergo-horizontal-negativo.svg | Cérebro colorido e nome branco em fundo escuro |
| noergo-horizontal-nanquim.svg | Uma cor em azul profundo; nome mantido por compatibilidade |
| noergo-horizontal-branco.svg | Uma cor branca em fundo escuro |
| noergo-empilhado*.svg | Composição vertical, nas mesmas quatro versões |
| noergo-logotipo*.svg | Somente o nome, azul profundo ou branco |
| noergo-simbolo*.svg | Cérebro colorido, azul profundo ou branco |
| noergo-icone.svg | Ícone com fundo azul profundo |
| noergo-icone-claro.svg | Ícone com fundo branco |
| noergo-icone-maskable.svg | Fundo cheio e símbolo dentro da zona segura |
| favicon.svg | Desenho simplificado para uso pequeno |

Na versão colorida, os canais e nós internos são brancos. Nas versões monocromáticas, são vazados transparentes.

## Proporção, proteção e redução

- A altura-x do nome é a unidade de referência.
- Na horizontal, o cérebro tem altura 1,55× e o espaço até o nome é 0,42×.
- A área de proteção mínima é 0,32× a altura-x, incluída nas composições SVG.
- Horizontal: recomenda-se pelo menos 160 px de largura ou 35 mm em impressão.
- Empilhada: pelo menos 120 px ou 28 mm.
- Símbolo detalhado: pelo menos 48 px. Abaixo disso, use o favicon simplificado.
- O favicon preserva as seis peças, com menos nós e aberturas maiores.

Os mínimos impressos são recomendações; valide uma prova no processo e suporte escolhidos. Não distorça, gire, espelhe, aplique efeitos ou altere a ordem das peças e cores.

## Tipografia de comunicação

Onest para títulos e assinatura. Figtree para leitura e controles. Spline Sans Mono apenas para código, atalhos e dados técnicos. As fontes locais em WOFF2 e suas licenças SIL OFL acompanham o design system.

## Arquivos entregues

- svg/: 17 matrizes vetoriais editáveis.
- png/: assinaturas transparentes em 512, 1024 e 2048 px; ícones em 256, 512 e 1024 px.
- app/: favicon SVG/ICO/PNG, Apple touch 180 px, ícones 192 e 512 px e maskable.
- social/: avatar 1024 px e imagem social 1200×630 / 2400×1260.
- apresentacao.svg e apresentacao.png: prancha da identidade final.
- identidade.json: especificação das escolhas, cores e procedência.

As matrizes SVG são a fonte editável definitiva. O pacote não inclui estudos descartados, ambiente Python ou scripts temporários de exploração.
