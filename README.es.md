<h1 align="center">Power Timeline</h1>

Power Timeline es un plugin de Decky para Steam Deck. Registra el cambio de batería en una línea temporal y da una estimación de energía del juego que estaba en marcha. En el menú de acceso rápido (QAM) puedes ver el estado actual y volver a los últimos 1, 3 o 7 días. Cerrar la página no detiene el registro.

Enchufado, la potencia de todo el aparato no se puede mostrar. La energía de los juegos es una estimación.

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.pt.md">Português</a> · <a href="./README.es.md">Español</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a>
</p>
<p align="center">
  <a href="#what">Qué ves</a> · <a href="#install">Instalar</a> · <a href="#try-it">Primer uso</a> · <a href="#limits">Ten en cuenta</a> · <a href="#language">Idioma</a> · <a href="./CHANGELOG.md">Cambios</a>
</p>
<p align="center">
  <img src="./docs/qam-menu.jpg" alt="Power Timeline en el menú de acceso rápido: batería, flujo de energía pequeño, últimas 24 horas y detalles de la batería" width="640">
</p>

Esta imagen es el menú de acceso rápido con el aparato enchufado. Muestra la batería actual, el flujo de energía pequeño, las últimas 24 horas y los detalles de la batería. Los vatios de la imagen no son la potencia de todo el aparato.

<h2 id="what">Qué ves</h2>

- Estado actual: batería, flujo de energía pequeño y detalles de la batería. Mientras carga, y cuando el sistema tiene una estimación, también ves aproximadamente cuánto falta para llenarse.
- Historial de la batería: el último día, los últimos 3 días o los últimos 7 días. Detente en un momento para ver el estado de entonces y el juego que se estaba registrando.
- Historial de juegos: una estimación de energía de cada juego.
- Límite de carga: activar o desactivar el límite de carga de Steam.

<h2 id="install">Instalar</h2>

### Instala Decky antes

Si Decky no está instalado, sigue las instrucciones oficiales de [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader#installation). Las mismas instrucciones están en la [wiki](https://wiki.deckbrew.xyz/en/user-guide/install).

### Descarga el paquete

Abre la [última release](https://github.com/ZacharyQin/power-timeline/releases/latest). Descarga el archivo cuyo nombre empieza por `power-timeline-` y termina en `.zip`. No descargues Source code (zip). Ese archivo es el código fuente, y Decky no puede instalarlo.

Si descargaste el ZIP en otro ordenador, cópialo a la Steam Deck.

### Instálalo en Decky

Los nombres de abajo son los de la interfaz de Decky en español. Este plugin no está en la tienda, así que se instala desde un ZIP.

1. Pulsa el botón de acceso rápido, abre el menú y ve al icono del enchufe. El título debe decir Decky. Si ya estás dentro de un plugin, pulsa la flecha a la izquierda del título hasta que diga Decky.
2. Elige el engranaje. La indicación es «Abrir los ajustes de Decky».
3. Abre General. En Otros, activa Modo desarrollador.
4. Desarrollador aparece entonces en la lista de la izquierda. Ábrelo.
5. En Plugins de terceros, busca Instalar plugin desde archivo ZIP y elige Navegar.
6. El cuadro dice que el equipo de Decky no ha revisado este plugin. La primera vez, espera unos 5 segundos antes de poder continuar.
7. Elige el ZIP cuyo nombre empieza por `power-timeline-`.

Cuando esté instalado, vuelve a la lista bajo el icono del enchufe y abre **Power Timeline**.

El servicio se ejecuta como root para leer el hardware. No cambia por su cuenta la política de energía del sistema, ni modifica los demás plugins.

### Actualizar y desinstalar

Para actualizar, descarga el ZIP `power-timeline-` nuevo en la misma página de la última release e instálalo otra vez con los pasos de arriba.

La desinstalación se hace en Plugins, dentro de los ajustes de Decky. Desinstalar no borra el historial. El historial suele estar en `~/homebrew/data/power-timeline/`. Para borrar también el historial, puedes borrar esa carpeta de datos.

<h2 id="try-it">Primer uso</h2>

1. Abre el menú de acceso rápido, ve al icono del enchufe y elige **Power Timeline**.
2. Lleva el foco a Últimas 24 horas y pulsa el botón de confirmar (A) para abrir la línea temporal de la batería.
3. Arriba de la página, elige Último día, Últimos 3 días o Últimos 7 días. Lleva el foco a la curva y usa izquierda y derecha para ver un momento. El gráfico muestra la batería y la potencia de ese momento. Si había un juego registrado, aparecen su icono y su nombre.
4. Elige Historial de juegos.
5. De vuelta en el menú de acceso rápido, enfoca el flujo de energía pequeño y pulsa confirmar para abrir el flujo de energía. Enfoca Batería y pulsa confirmar para abrir energía y batería.

La primera vez no hay historial anterior. El uso de antes de encender el plugin no se rellena.

<details>
<summary>Pantalla táctil y otros controles</summary>

- Toca Últimas 24 horas para abrir la línea temporal. Toca el flujo de energía pequeño para abrir el flujo de energía. Toca Batería para abrir energía y batería.
- Izquierda y derecha en el gráfico de 24 horas del menú de acceso rápido solo marcan un momento temporal. No abren la línea temporal.
- En la curva de la línea temporal, un arrastre horizontal elige un momento. Un toque sin arrastre no elige.

</details>

<h2 id="limits">Ten en cuenta</h2>

- La potencia de todo el aparato solo existe cuando se confirma que la batería se está descargando. Enchufado, queda desconocida. La potencia de carga, la potencia neta de la batería y la potencia de la APU no ocupan su lugar.
- La energía de los juegos es una estimación. Dos juegos a la vez no reciben cada uno el total del aparato.
- Un número que falta sigue siendo desconocido. No se muestra como 0. El tiempo hasta llenarse sale de la estimación del sistema. No es una cuenta exacta.
- El límite de carga solo enciende o apaga el interruptor que ya existe en Steam. El porcentaje se sigue cambiando en Steam.
- Los registros se quedan en el aparato. No se envían.
- Probado en una Steam Deck (Galileo). Los demás modelos no están verificados.

<details>
<summary>Qué incluye la estimación de energía</summary>

La estimación de energía del juego cubre la energía de CPU y GPU que se puede repartir según la actividad de los procesos. No es la energía de todo el aparato al ejecutar ese juego. No incluye la pantalla, la potencia del SoC leída aparte, ni el uso del sistema que no se asignó a ese juego.

</details>

<h2 id="language">Idioma</h2>

Sigue el idioma de la interfaz de Steam hasta que elijas uno.

Puedes elegir chino simplificado, inglés, portugués, español, japonés y coreano. Hay una fila de banderas al final del menú de acceso rápido y de cada página. Izquierda, derecha o un deslizamiento horizontal solo mueven el resalte. Confirmar cambia el idioma. La frase usa el idioma de esa bandera. La elección se recuerda.

Este documento existe en los mismos seis idiomas. Usa los enlaces de arriba.

<details>
<summary>Cómo corresponden los idiomas de Steam</summary>

| Bandera | Interfaz | Idioma de Steam |
| --- | --- | --- |
| China | Chino simplificado | Simplificado, tradicional y otros chinos |
| Estados Unidos | Inglés | Inglés, y cualquier idioma no listado abajo |
| Portugal | Portugués | El portugués y el portugués de Brasil comparten este texto |
| España | Español | El español y el español latinoamericano comparten este texto |
| Japón | Japonés | Japonés |
| Corea del Sur | Coreano | Coreano |

</details>

<details>
<summary>Compilar desde el código</summary>

Hacen falta Node.js, pnpm y Python 3.

```sh
pnpm install --registry=https://registry.npmjs.org
pnpm typecheck
pnpm build
python3 -m unittest discover -s tests -v
```

`pnpm build` genera la interfaz. Mete los archivos de ejecución en el ZIP antes de instalar. No pongas la base de datos en la carpeta del plugin.

</details>

## Licencia

[BSD 3-Clause](./LICENSE). Copyright (c) 2026, Zachary. Este es un plugin independiente, no un proyecto oficial de Valve, SteamOS o Decky.
