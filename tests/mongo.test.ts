import { expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { createStore } from "../backend/src/store.js";
import { reconcile } from "../backend/src/engine.js";
import type { ParsedGstr2B, ParsedPurchase } from "../shared/types.js";

it("persists and reloads a complete run using temporary MongoDB", async () => {
  const mongo = await MongoMemoryServer.create();
  try {
    const store = await createStore("unused", mongo.getUri());
    const purchase: ParsedPurchase = {
      filename: "p.xlsx",
      hash: "p",
      sourceSheet: { name: "PR", headerRow: 1, values: [] },
      lines: [],
    };
    const gst: ParsedGstr2B = {
      filename: "g.xlsx",
      hash: "g",
      records: [],
    };
    const run = reconcile(purchase, gst);
    await store.save(run);
    expect(await store.get(run.id)).toEqual(run);
    expect((await store.list())[0].summary).toEqual(run.summary);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}, 120000);
