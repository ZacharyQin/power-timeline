import { readFileSync } from "node:fs";
import deckyPlugin from "@decky/rollup";
import licenseNotices from "./scripts/license-notices.mjs";

function frontAssets() {
  return {
    name: "front-assets",
    generateBundle() {
      for (const name of ["front-hardware.webp", "front-rotor.webp", "front-fan-front.webp"]) {
        this.emitFile({
          type: "asset",
          fileName: name,
          source: readFileSync(new URL(`./src/assets/${name}`, import.meta.url)),
        });
      }
    },
  };
}

const config = deckyPlugin({ plugins: [frontAssets(), licenseNotices()] });
config.output = { ...config.output, sourcemap: false };
export default config;
