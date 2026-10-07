import "dotenv/config";
import { resolve } from "node:path";
import { createStore } from "./store.js";
import { createApp } from "./app.js";
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 5000);
const token = process.env.APP_ACCESS_TOKEN ?? "";
if (!["127.0.0.1", "localhost", "::1"].includes(host) && token.length < 24)
  throw new Error(
    "Set APP_ACCESS_TOKEN of at least 24 characters before enabling network access.",
  );
let store;
let databaseWarning = "";
try {
  store = await createStore(
    resolve(process.env.DATA_DIR ?? "data"),
    process.env.MONGODB_URI || undefined,
  );
} catch {
  databaseWarning =
    "MongoDB sign-in needs correction. Excel generation is available; results are being saved locally.";
  console.warn(databaseWarning);
  store = await createStore(resolve(process.env.DATA_DIR ?? "data"));
}
createApp(store, token, resolve("dist"), databaseWarning).listen(
  port,
  host,
  () =>
    console.log(
      `GST Reconciliation ready at http://${host}:${port} (${store.kind} history)`,
    ),
);
