import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_QAM_ORDER, normalizeQamOrder } from "../src/qamOrder.ts";
import { qamSortReducer } from "../src/qamSort.ts";

test("saved order survives removed, duplicate, and newly added components", () => {
  const result = normalizeQamOrder(["fan", "removed-component", "battery", "fan", null, {}, 7]);
  assert.deepEqual(result, ["fan", "battery", ...DEFAULT_QAM_ORDER.filter((id) => id !== "fan" && id !== "battery")]);
});

test("saving survives reload and a storage failure keeps the last saved order", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map();
  let fail = false;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (fail) throw new Error("storage unavailable");
        values.set(key, value);
      },
    },
  });
  try {
    const store = await import("../src/qamOrder.ts?save");
    const chosen = ["language", ...DEFAULT_QAM_ORDER.filter((id) => id !== "language")];
    store.saveQamOrder(chosen);
    const reloaded = await import("../src/qamOrder.ts?reload");
    assert.deepEqual(reloaded.getQamOrder(), chosen);
    let notifications = 0;
    const unsubscribe = store.subscribeQamOrder(() => { notifications += 1; });
    fail = true;
    assert.throws(() => store.saveQamOrder(DEFAULT_QAM_ORDER), /storage unavailable/);
    assert.deepEqual(store.getQamOrder(), chosen);
    assert.equal(notifications, 0);
    unsubscribe();
    const afterFailure = await import("../src/qamOrder.ts?failed");
    assert.deepEqual(afterFailure.getQamOrder(), chosen);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});

test("canceling a lift preserves earlier dropped moves, then cancel exits the draft", () => {
  const saved = Object.freeze(["battery", "flow", "fan", "language"]);
  let state = qamSortReducer(null, { type: "begin", order: saved });
  state = qamSortReducer(state, { type: "activate", id: "battery" });
  state = qamSortReducer(state, { type: "move", direction: 1 });
  state = qamSortReducer(state, { type: "activate", id: "battery" });
  assert.deepEqual(state.order, ["flow", "battery", "fan", "language"]);
  assert.equal(state.lifted, null);
  state = qamSortReducer(state, { type: "activate", id: "language" });
  state = qamSortReducer(state, { type: "move", direction: -1 });
  state = qamSortReducer(state, { type: "move", direction: -1 });
  assert.deepEqual(state.order, ["flow", "language", "battery", "fan"]);
  state = qamSortReducer(state, { type: "cancel" });
  assert.deepEqual(state.order, ["flow", "battery", "fan", "language"]);
  assert.equal(state.lifted, null);
  assert.equal(qamSortReducer(state, { type: "cancel" }), null);
  assert.deepEqual(saved, ["battery", "flow", "fan", "language"]);
});

test("only the lifted component moves and list boundaries never wrap", () => {
  let state = qamSortReducer(null, { type: "begin", order: ["battery", "flow"] });
  assert.equal(qamSortReducer(state, { type: "move", direction: 1 }), state);
  state = qamSortReducer(state, { type: "activate", id: "battery" });
  assert.equal(qamSortReducer(state, { type: "activate", id: "flow" }), state);
  assert.equal(qamSortReducer(state, { type: "move", direction: -1 }), state);
  state = qamSortReducer(state, { type: "move", direction: 1 });
  assert.deepEqual(state.order, ["flow", "battery"]);
  assert.equal(qamSortReducer(state, { type: "move", direction: 1 }), state);
});

test("restore default releases the lifted component without modifying saved order", () => {
  const saved = Object.freeze(["language", "battery", "flow"]);
  let state = qamSortReducer(null, { type: "begin", order: saved });
  state = qamSortReducer(state, { type: "activate", id: "language" });
  state = qamSortReducer(state, { type: "move", direction: 1 });
  state = qamSortReducer(state, { type: "reset", order: DEFAULT_QAM_ORDER });
  assert.deepEqual(state.order, DEFAULT_QAM_ORDER);
  assert.equal(state.lifted, null);
  assert.deepEqual(saved, ["language", "battery", "flow"]);
});
