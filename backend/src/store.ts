import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import type { Run } from "../../shared/types.js";
export interface Store {
  kind: string;
  get(id: string): Promise<Run | null>;
  save(run: Run): Promise<void>;
  list(): Promise<Pick<Run, "id" | "createdAt" | "summary">[]>;
}
export async function createStore(
  directory: string,
  uri?: string,
): Promise<Store> {
  if (uri) {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const schema = new mongoose.Schema(
      {
        id: { type: String, unique: true, required: true },
        createdAt: String,
        summary: mongoose.Schema.Types.Mixed,
        payload: mongoose.Schema.Types.ObjectId,
      },
      { versionKey: false },
    );
    const Meta =
      mongoose.models.ReconciliationRun ??
      mongoose.model("ReconciliationRun", schema);
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db!, {
      bucketName: "runPayloads",
    });
    return {
      kind: "mongodb",
      async get(id) {
        const meta = (await Meta.findOne({ id }).lean()) as {
          payload: mongoose.Types.ObjectId;
        } | null;
        if (!meta) return null;
        const chunks: Buffer[] = [];
        for await (const chunk of bucket.openDownloadStream(meta.payload))
          chunks.push(chunk);
        return JSON.parse(Buffer.concat(chunks).toString()) as Run;
      },
      async save(run) {
        const upload = bucket.openUploadStream(`${run.id}.json`, {
          metadata: { runId: run.id, ruleVersion: run.ruleVersion },
        });
        await new Promise<void>((resolve, reject) => {
          upload.on("finish", resolve);
          upload.on("error", reject);
          upload.end(Buffer.from(JSON.stringify(run)));
        });
        try {
          await Meta.updateOne(
            { id: run.id },
            {
              $set: {
                createdAt: run.createdAt,
                summary: run.summary,
                payload: upload.id,
              },
            },
            { upsert: true },
          );
        } catch (e) {
          await bucket.delete(upload.id);
          throw e;
        }
        // Earlier payload snapshots retained for an audit trail; retention is an explicit operator decision.
      },
      async list() {
        const rows = await Meta.find()
          .sort({ createdAt: -1 })
          .limit(100)
          .lean();
        return rows.map((r) => ({
          id: String(r.id),
          createdAt: String(r.createdAt),
          summary: r.summary as Run["summary"],
        }));
      },
    };
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return {
    kind: "local",
    async get(id) {
      try {
        return JSON.parse(
          await readFile(join(directory, `${id}.json`), "utf8"),
        ) as Run;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async save(run) {
      const temp = join(directory, `${run.id}.${randomUUID()}.tmp`);
      await writeFile(temp, JSON.stringify(run), { mode: 0o600 });
      await rename(temp, join(directory, `${run.id}.json`));
    },
    async list() {
      const files = (await readdir(directory)).filter((f) =>
        /^[a-f0-9-]{36}\.json$/.test(f),
      );
      const runs = await Promise.all(
        files.map(
          async (f) =>
            JSON.parse(await readFile(join(directory, f), "utf8")) as Run,
        ),
      );
      return runs
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 100)
        .map(({ id, createdAt, summary }) => ({ id, createdAt, summary }));
    },
  };
}
