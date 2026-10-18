<h1 align="center">Power Timeline</h1>

> Um registo de bateria para a Steam Deck. Veja o uso atual no menu de acesso rápido e consulte o uso anterior.

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.pt.md">Português</a> · <a href="./README.es.md">Español</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a>
</p>
<p align="center">
  <a href="#what">O que faz</a> · <a href="#install">Instalar</a> · <a href="#try-it">Como usar</a> · <a href="#language">Idioma</a> · <a href="#limits">Tenha em atenção</a>
</p>
<p align="center">
  <img src="./docs/qam-home.jpg" alt="Power Timeline no menu de acesso rápido: bateria, fluxo de energia, últimas 24 horas e detalhes da bateria" width="100%">
</p>

<h2 id="what">O que faz</h2>

Um plugin Decky. Regista a bateria, a potência do aparelho e a energia de cada jogo. Fechar a página não para o registo.

No menu de acesso rápido:

- Bateria atual e uma imagem pequena do fluxo de energia
- As últimas 24 horas; confirmar abre a linha temporal
- Durante a carga, cerca de quanto falta até ficar cheia
- O limite de carga já guardado na Steam
- Fluxo de energia, energia e bateria, e histórico de jogos

A linha temporal mostra o último dia, 3 dias ou 7 dias. Esquerda, direita ou um arrasto para o lado param num momento.

<h2 id="install">Instalar</h2>

Instale o Decky. Descarregue o ZIP mais recente em [Releases](https://github.com/ZacharyQin/power-timeline/releases/latest) e instale esse ZIP no Decky. O Decky mostra **Power Timeline**.

O serviço corre como root para ler hardware. Não altera a política de energia nem os outros plugins.

Para atualizar, descarregue o ZIP novo na mesma página de Releases e instale-o outra vez. Desinstalar não apaga o histórico. Fica normalmente em `~/homebrew/data/power-timeline/`.

<details>
<summary>Construir a partir do código</summary>

São necessários Node.js, pnpm e Python 3.

```sh
pnpm install --registry=https://registry.npmjs.org
pnpm typecheck
pnpm build
python3 -m unittest discover -s tests -v
```

`pnpm build` gera a interface. Junte os ficheiros de execução no ZIP. Não ponha a base de dados na pasta do plugin.

</details>

<h2 id="try-it">Como usar</h2>

1. Abra Decky → **Power Timeline**. Comece pela bateria e pela imagem pequena do fluxo.
2. Foque o gráfico de 24 horas e confirme. Em cima, mude 1, 3 ou 7 dias.
3. Passe para o gráfico. Esquerda, direita ou um arrasto escolhem um momento. O gráfico mostra a bateria e a potência, e o ícone e o nome se um jogo estava a ser observado.
4. Durante a carga, vê cerca de quanto falta até ficar cheia. O limite usa a percentagem já guardada na Steam.
5. Confirme a imagem pequena para abrir o fluxo. Confirme o bloco da bateria para abrir energia e bateria.

Na primeira vez não há histórico anterior, nem uso de antes de ligar o plugin.

<h2 id="language">Idioma</h2>

Segue a Steam até escolher. As bandeiras ficam no fundo do menu e de cada página. Esquerda, direita ou um deslize só movem o destaque. Confirmar muda o idioma. A frase está no idioma da bandeira.

| Bandeira | Interface | Idioma da Steam |
| --- | --- | --- |
| China | Chinês simplificado | Chinês simplificado, tradicional e outros |
| Estados Unidos | Inglês | Inglês, e qualquer idioma não listado abaixo |
| Portugal | Português | Português e português do Brasil partilham este texto |
| Espanha | Espanhol | Espanhol e espanhol da América Latina partilham este texto |
| Japão | Japonês | Japonês |
| Coreia do Sul | Coreano | Coreano |

A escolha fica guardada. Este documento existe nas mesmas seis línguas. Use as ligações no topo.

<h2 id="limits">Tenha em atenção</h2>

- Ligado à corrente, o uso do aparelho fica desconhecido. A potência de carga não ocupa o lugar.
- A energia de um jogo é uma estimativa. Dois jogos ao mesmo tempo não recebem cada um uma cópia completa.
- Um número em falta fica desconhecido. Não aparece como 0.
- O limite só liga ou desliga o interruptor da Steam. A percentagem continua nas definições da Steam.
- Os registos ficam no aparelho. Não são enviados.
- Experimentado numa Steam Deck (Galileo). Os outros modelos não foram verificados.

## Licença

[BSD 3-Clause](./LICENSE). Copyright (c) 2026, Zachary. Este é um plugin independente, não um projeto oficial da Valve, do SteamOS ou do Decky.
