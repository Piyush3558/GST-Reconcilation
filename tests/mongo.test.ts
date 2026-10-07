import { it, expect } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { createStore } from "../backend/src/store.js";
import { reconcile } from "../backend/src/engine.js";
it("persists and reloads a complete run using an actual temporary MongoDB", async () => {
  const mongo = await MongoMemoryServer.create();
  try {
    const store = await createStore("unused", mongo.getUri());
    const fixture = { documents: [], issues: [], sheets: [], hash: "synthetic", filename: "fixture.xlsx" };
    const run = reconcile(fixture, fixture);
    await store.save(run);
    expect(await store.get(run.id)).toEqual(run);
    expect((await store.list())[0].summary).toEqual(run.summary);
    run.audit.push({
      at: new Date().toISOString(),
      actor: "test",
      action: "TEST",
      detail: "persistence update",
    });
    await store.save(run);
    expect((await store.get(run.id))?.audit.at(-1)?.action).toBe("TEST");
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}, 120000);
