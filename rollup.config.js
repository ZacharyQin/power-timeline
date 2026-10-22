import { readFileSync } from "node:fs";
import deckyPlugin from "@decky/rollup";

function frontAssets() {
  return {
    name: "front-assets",
    generateBundle() {
      for (const name of ["front-hardware.png", "front-rotor.png", "front-fan-front.png"]) {
        this.emitFile({
          type: "asset",
          fileName: name,
          source: readFileSync(new URL(`./src/assets/${name}`, import.meta.url)),
        });
      }
    },
  };
}

export default deckyPlugin({ plugins: [frontAssets()] });
