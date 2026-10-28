import assert from "node:assert/strict";
import { test } from "node:test";
import { gameIconSources, presentationAppId } from "../src/gamePresentation.ts";

test("shortcut SteamGameIds resolve exactly without rounding or changing history identity", () => {
  for (const appId of [0x80000000, 2355037391, 2374390246, 0xffffffff]) {
    const identity = ((BigInt(appId) << 32n) | 0x02000000n).toString();
    assert.equal(presentationAppId(identity), appId);
    assert.equal(presentationAppId(String(appId)), appId);
  }
});

test("only positive 32-bit AppIDs and tagged shortcut game IDs can select library metadata", () => {
  assert.equal(presentationAppId("220"), 220);
  assert.equal(presentationAppId("4294967295"), 0xffffffff);
  for (const identity of ["", "0", "-220", "+220", "220.0", "2.2e2", " 220", "220 ", "4294967296", "9007199254740993", ((1n << 64n) | 0x02000000n).toString(), ((2355037391n << 32n) | 0x01000000n).toString()]) {
    assert.equal(presentationAppId(identity), null, identity);
  }
});

test("current shortcut icons beat stale grid artwork while Steam custom artwork beats store defaults", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const native = "data:image/x-icon;base64,AA==";
  const saved = "/customimages/220_icon.png?v=2";
  Object.defineProperty(globalThis, "window", { configurable: true, value: { appStore: {
    GetCustomImageURLs: () => ["/customimages/220_icon.png?v=1"],
    GetIconURLForApp: (app) => app.icon_data ? native : "https://shared.steamstatic.com/store-default.jpg",
  } } });
  try {
    assert.equal(gameIconSources({ icon_data: "current", icon_data_format: "ico" }, saved)[0], native);
    assert.equal(gameIconSources({ icon_hash: "store-default" }, saved)[0], saved);
    assert.equal(gameIconSources(null, saved)[0], saved);
    assert.equal(gameIconSources({ icon_hash: "store-default" }, saved, true).at(-1), saved);
    assert.equal(gameIconSources({ icon_hash: "store-default" }, saved, true).at(-2), "https://shared.steamstatic.com/store-default.jpg");
    assert.equal(gameIconSources(null, saved, true)[0], saved);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else delete globalThis.window;
  }
});
