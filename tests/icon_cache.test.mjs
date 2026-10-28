import assert from "node:assert/strict";
import { test } from "node:test";
import { rememberDisplayedIcon } from "../src/iconCache.ts";

test("duplicate displayed-icon events share a write and distinct accounts or revisions do not", async () => {
  let writes = 0;
  const save = async (app, account, source) => { writes += 1; return { app, account, source }; };
  await Promise.all([
    rememberDisplayedIcon("220", "1", "first", save),
    rememberDisplayedIcon("220", "1", "first", save),
    rememberDisplayedIcon("220", "1", "first", save),
  ]);
  assert.equal(writes, 1);
  await rememberDisplayedIcon("220", "1", "first", save);
  assert.equal(writes, 1);
  await rememberDisplayedIcon("220", "2", "first", save);
  await rememberDisplayedIcon("220", "1", "updated", save);
  assert.equal(writes, 3);
});

test("a failed archive can retry instead of being marked saved for the rest of the session", async () => {
  let attempts = 0;
  const save = async () => { if (++attempts === 1) throw new Error("disk full"); return true; };
  await assert.rejects(rememberDisplayedIcon("221", "1", "retry", save), /disk full/);
  assert.equal(await rememberDisplayedIcon("221", "1", "retry", save), true);
  assert.equal(attempts, 2);
});
