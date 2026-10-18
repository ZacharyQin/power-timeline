<h1 align="center">Power Timeline</h1>

> Un registro de batería para Steam Deck. Mira el uso actual en el menú de acceso rápido y consulta el uso anterior.

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.pt.md">Português</a> · <a href="./README.es.md">Español</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a>
</p>
<p align="center">
  <a href="#what">Qué hace</a> · <a href="#install">Instalar</a> · <a href="#try-it">Cómo usarlo</a> · <a href="#language">Idioma</a> · <a href="#limits">Ten en cuenta</a> · <a href="./CHANGELOG.md">Cambios</a>
</p>
<p align="center">
  <img src="./docs/qam-home.jpg" alt="Power Timeline en el menú de acceso rápido: batería, flujo de energía, últimas 24 horas y detalles de la batería" width="100%">
</p>

<h2 id="what">Qué hace</h2>

Un plugin de Decky. Registra la batería, la potencia del aparato y la energía de cada juego. Cerrar la página no detiene el registro.

Desde el menú de acceso rápido:

- Batería actual y un dibujo pequeño del flujo de energía
- Las últimas 24 horas; confirmar abre la línea temporal
- Durante la carga, cuánto falta aproximadamente hasta llenarse
- El límite de carga ya guardado en Steam
- Flujo de energía, energía y batería, e historial de juegos

La línea temporal muestra el último día, 3 días o 7 días. Izquierda, derecha o un arrastre de lado se detienen en un momento.

<h2 id="install">Instalar</h2>

Instala Decky. Descarga el ZIP más reciente en [Releases](https://github.com/ZacharyQin/power-timeline/releases/latest) e instala ese ZIP en Decky. Decky muestra **Power Timeline**.

El servicio se ejecuta como root para leer hardware. No cambia la política de energía ni los demás plugins.

Para actualizar, descarga el ZIP nuevo en la misma página de Releases e instálalo otra vez. Desinstalar no borra el historial. Suele estar en `~/homebrew/data/power-timeline/`.

<details>
<summary>Construir desde el código</summary>

Hacen falta Node.js, pnpm y Python 3.

```sh
pnpm install --registry=https://registry.npmjs.org
pnpm typecheck
pnpm build
python3 -m unittest discover -s tests -v
```

`pnpm build` genera la interfaz. Junta los archivos de ejecución en el ZIP. No pongas la base de datos en la carpeta del plugin.

</details>

<h2 id="try-it">Cómo usarlo</h2>

1. Abre Decky → **Power Timeline**. Empieza por la batería y el dibujo pequeño del flujo.
2. Enfoca el gráfico de 24 horas y confirma. Arriba, cambia 1, 3 o 7 días.
3. Pasa al gráfico. Izquierda, derecha o un arrastre eligen un momento. El gráfico muestra la batería y la potencia, y el icono y el nombre si se observaba un juego.
4. Durante la carga, ves cuánto falta aproximadamente hasta llenarse. El límite usa el porcentaje ya guardado en Steam.
5. Confirma el dibujo pequeño para abrir el flujo. Confirma el bloque de la batería para abrir energía y batería.

La primera vez no hay historial anterior, ni uso de antes de encender el plugin.

<h2 id="language">Idioma</h2>

Sigue a Steam hasta que elijas. Las banderas están al final del menú y de cada página. Izquierda, derecha o un deslizamiento solo mueven el resalte. Confirmar cambia el idioma. La frase está en el idioma de la bandera.

| Bandera | Interfaz | Idioma de Steam |
| --- | --- | --- |
| China | Chino simplificado | Chino simplificado, tradicional y otros |
| Estados Unidos | Inglés | Inglés, y cualquier idioma que no esté abajo |
| Portugal | Portugués | El portugués y el portugués de Brasil comparten este texto |
| España | Español | El español y el español de América Latina comparten este texto |
| Japón | Japonés | Japonés |
| Corea del Sur | Coreano | Coreano |

La elección se recuerda. Este documento existe en los mismos seis idiomas. Usa los enlaces de arriba.

<h2 id="limits">Ten en cuenta</h2>

- Enchufada, el uso del aparato queda desconocido. La potencia de carga no ocupa su lugar.
- La energía de un juego es una estimación. Dos juegos a la vez no reciben cada uno una copia completa.
- Un número que falta queda desconocido. No se muestra como 0.
- El límite solo enciende o apaga el interruptor de Steam. El porcentaje se sigue cambiando en Steam.
- Los registros se quedan en el aparato. No se envían.
- Probado en una Steam Deck (Galileo). Los demás modelos no están verificados.

## Licencia

[BSD 3-Clause](./LICENSE). Copyright (c) 2026, Zachary. Este es un plugin independiente, no un proyecto oficial de Valve, SteamOS o Decky.
