import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = path => readFileSync(path, "utf8");
const metadata = path => JSON.parse(read(join(path, "package.json")));
const document = (title, text) => {
  if (!text.trim()) throw new Error(`Empty license material: ${title}`);
  return { title, text };
};
const retained = name => document(name, read(join(root, "licenses", name)));
function packageRoot(file) {
  let directory = dirname(file);
  while (directory !== dirname(directory)) {
    if (existsSync(join(directory, "package.json")) && metadata(directory).name) return directory;
    directory = dirname(directory);
  }
  throw new Error(`No package metadata for bundled module: ${file}`);
}
function packageEntry(directory, group, host = false) {
  const pkg = metadata(directory);
  const files = readdirSync(directory).filter(name => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name)).sort();
  const documents = pkg.name === "react-icons" ? [retained("React-Icons-MIT.txt")]
    : files.map(name => document(name, read(join(directory, name))));
  if (!documents.length || typeof pkg.license !== "string") throw new Error(`Missing license: ${pkg.name}`);
  const repository = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  const source = (repository || pkg.homepage || `https://www.npmjs.com/package/${pkg.name}`)
    .replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/^ssh:\/\/git@([^/:]+)[:/]/, "https://$1/").replace(/\.git$/, "");
  const author = (typeof pkg.author === "string" ? pkg.author : pkg.author?.name) || "";
  const copyright = [...new Set(documents.flatMap(doc => doc.text.split("\n")
    .filter(line => /^\s*Copyright\s+(?:\(c\)\s*)?(?:\d{4}|©)/i.test(line)).map(line => line.trim())))].join("\n");
  return { id: pkg.name, name: pkg.name, version: pkg.version, group, host, license: pkg.license,
    source, attribution: pkg.license.startsWith("LGPL") ? author : copyright || author, documents };
}

export default function licenseNotices() {
  return {
    name: "power-timeline-license-notices",
    generateBundle(_options, bundle) {
      const own = metadata(root);
      const modules = Object.values(bundle).filter(item => item.type === "chunk")
        .flatMap(chunk => Object.entries(chunk.modules).filter(([, info]) => info.renderedLength > 0).map(([id]) => id));
      const roots = new Map();
      for (const id of modules) {
        if (!isAbsolute(id) || id.startsWith("\0")) continue;
        const directory = packageRoot(id);
        const name = metadata(directory).name;
        if (name !== own.name) roots.set(name, directory);
      }
      const entries = [{ id: "project", name: "Power Timeline", version: own.version, group: "project", host: false,
        license: own.license, source: "https://github.com/ZacharyQin/power-timeline",
        attribution: "Copyright (c) 2026, Zachary",
        documents: [document("LICENSE", read(join(root, "LICENSE"))), retained("REBUILD.txt")] }];
      for (const [name, directory] of [...roots].sort(([a], [b]) => a.localeCompare(b))) {
        const entry = packageEntry(directory, name === "react-icons" ? "icons" : "bundled");
        if (name === "@decky/api") {
          if (entry.version !== "1.1.3") throw new Error("Update the pinned Decky API source and compiler configuration before changing its version");
          entry.source = "https://github.com/SteamDeckHomebrew/loader-api/tree/d1b7f16070777a0ada939cbacd3606eeba0574f5";
          entry.documents.push(retained("REBUILD.txt"));
          entry.note = "rebuild";
        } else if (entry.license.startsWith("LGPL")) {
          throw new Error(`Add matching source material for ${name}`);
        }
        entries.push(entry);
      }
      entries.push(packageEntry(resolve(root, "node_modules/@decky/ui"), "host", true));
      entries.push({ id: "react", name: "React / JSX runtime", version: null, group: "host", host: true,
        license: "MIT", source: "https://github.com/facebook/react", attribution: "Meta Platforms, Inc. and affiliates.",
        documents: [retained("React-MIT.txt")] });
      entries.push({ id: "dbus-next", name: "dbus-next", version: null, group: "host", host: true,
        license: "MIT", source: "https://github.com/altdesktop/python-dbus-next", attribution: "Copyright (c) 2019 Tony Crisci",
        documents: [retained("DBus-Next-MIT.txt")] });
      if (modules.some(id => id.includes("/react-icons/fa/"))) entries.push({
        id: "font-awesome-5", name: "Font Awesome Free 5", version: "5.15.4-3-gafecf2a", group: "icons", host: false,
        license: "CC-BY-4.0", source: "https://github.com/FortAwesome/Font-Awesome/tree/afecf2a", attribution: "Fonticons, Inc.",
        note: "font-awesome", documents: [retained("Font-Awesome-5.txt"), retained("CC-BY-4.0.txt")],
      });
      if (modules.some(id => id.includes("/react-icons/fi/"))) entries.push({
        id: "feather", name: "Feather", version: "4.29.1", group: "icons", host: false,
        license: "MIT", source: "https://github.com/feathericons/feather/tree/v4.29.1", attribution: "Copyright (c) 2013-2023 Cole Bemis",
        documents: [retained("Feather-MIT.txt")],
      });
      entries.push({ id: "hardware-artwork", name: "Steam Deck hardware artwork", version: "20220202 CAD / project reconstruction", group: "artwork", host: false,
        license: "CC-BY-NC-SA-4.0", source: "https://gitlab.steamos.cloud/SteamHardware/SteamDeck",
        attribution: "Copyright 2019 Valve Corporation; project illustrative reconstruction", note: "artwork",
        documents: [retained("assets/NOTICE.txt"), retained("Valve-CAD.txt")] });
      const apiRoot = roots.get("@decky/api");
      if (!apiRoot) throw new Error("Bundled Decky API source was not identified");
      const sources = execFileSync("python3", [join(root, "scripts/license-sources.py"), apiRoot], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
      this.emitFile({ type: "asset", fileName: "license-sources.zip", source: sources });
      const sourceName = `power-timeline-${own.version}-sources.zip`;
      const sourceArchive = { name: sourceName,
        url: `https://github.com/ZacharyQin/power-timeline/releases/download/v${own.version}/${sourceName}` };
      this.emitFile({ type: "asset", fileName: "notices.json", source: JSON.stringify({ entries, sourceArchive }, null, 2) + "\n" });
    },
  };
}
