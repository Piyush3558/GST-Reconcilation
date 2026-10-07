import { afterAll, beforeAll, describe, it, expect } from "vitest";
import request from "supertest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, type Store } from "../server/store.js";
import { createApp } from "../server/app.js";
import type { Run } from "../shared/types.js";
let store: Store;
let directory: string;
let app: ReturnType<typeof createApp>;
let run: Run;
const purchase = process.env.GST_PURCHASE_PATH!,
  gst = process.env.GST_2B_PATH!;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "gst-api-tests-"));
  store = await createStore(directory);
  app = createApp(store);
});
describe.skipIf(!purchase || !gst)("private-fixture API end to end", () => {
  it("reports storage mode", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.storage).toBe("local");
  });
  it("rejects missing authentication when configured", async () => {
    const secured = createApp(store, "a-secret-for-test");
    expect((await request(secured).get("/api/runs")).status).toBe(401);
    expect(
      (
        await request(secured)
          .get("/api/runs")
          .set("Authorization", "Bearer a-secret-for-test")
      ).status,
    ).toBe(200);
  });
  it("rejects cross-origin calls", async () =>
    expect(
      (
        await request(app)
          .get("/api/runs")
          .set("Origin", "https://untrusted.example")
      ).status,
    ).toBe(403));
  it("validates both uploaded files", async () => {
    const res = await request(app)
      .post("/api/validate")
      .attach("purchase", purchase)
      .attach("gst2b", gst);
    expect(res.status).toBe(200);
    expect(res.body.purchase.records).toBe(92);
    expect(res.body.gst.records).toBe(63);
  });
  it("rejects one missing file", async () =>
    expect(
      (await request(app).post("/api/runs").attach("purchase", purchase))
        .status,
    ).toBe(400));
  it("creates a run from actual workbooks", async () => {
    const res = await request(app)
      .post("/api/runs")
      .attach("purchase", purchase)
      .attach("gst2b", gst);
    expect(res.status).toBe(201);
    run = res.body;
    expect(run.summary.baseline.exactTax).toBe(36);
  }, 30000);
  it("lists and reloads persisted runs across store instances", async () => {
    const res = await request(app).get("/api/runs");
    expect(res.body).toHaveLength(1);
    const reloaded = await createStore(directory);
    expect((await reloaded.get(run.id))?.summary).toEqual(run.summary);
    expect((await request(app).get(`/api/runs/${run.id}`)).status).toBe(200);
  });
  it("downloads an XLSX workbook", async () => {
    const res = await request(app).get(`/api/runs/${run.id}/download`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(Number(res.headers["content-length"])).toBeGreaterThan(1000);
  });
  it("validates reviewer evidence", async () =>
    expect(
      (
        await request(app)
          .post(`/api/runs/${run.id}/approve`)
          .send({ purchaseId: "x", gstId: "y", actor: "", reason: "" })
      ).status,
    ).toBe(400));
  it("records a supported manual pairing and rejects a repeated approval", async () => {
    const c = run.results.find((r) => r.purchase && r.candidates.length === 1)!
      .candidates[0];
    const body = {
      ...c,
      actor: "Test reviewer",
      reason: "Synthetic API verification of pairing workflow",
    };
    const res = await request(app)
      .post(`/api/runs/${run.id}/approve`)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.summary.paired).toBe(38);
    expect(res.body.audit.at(-1).action).toBe("CANDIDATE_APPROVED");
    expect(
      (await request(app).post(`/api/runs/${run.id}/approve`).send(body))
        .status,
    ).toBe(409);
  });
  it("rejects unsafe identifiers and non-workbooks", async () => {
    expect((await request(app).get("/api/runs/not-a-uuid")).status).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/runs")
          .attach("purchase", Buffer.from("invalid"), { filename: "test.xlsx" })
          .attach("gst2b", gst)
      ).status,
    ).toBe(400);
  });
});
