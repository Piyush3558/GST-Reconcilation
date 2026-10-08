import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import ExcelJS from "exceljs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../backend/src/store.js";
import { createApp } from "../backend/src/app.js";

async function fixtureBuffers() {
  const purchase = new ExcelJS.Workbook();
  const pr = purchase.addWorksheet("Purchase");
  pr.addRow([
    "Supplier Name",
    "Supplier GSTIN",
    "Vendor Invoice No.",
    "Vendor Invoice Date",
    "GST Base Amount",
    "IGST Amt.",
    "CGST Amt.",
    "SGST Amt.",
  ]);
  pr.addRow(["Supplier", "27AAAAA0000A1Z5", "INV/1", "01-08-26", 100, 0, 9, 9]);
  const gst = new ExcelJS.Workbook();
  const b2b = gst.addWorksheet("B2B");
  b2b.addRow([
    "GSTIN of supplier",
    "Supplier name",
    "Invoice number",
    "Invoice type",
    "Invoice Date",
    "Invoice Value(₹)",
    "Place of supply",
    "Supply Attract Reverse Charge",
    "Taxable Value (₹)",
    "Integrated Tax(₹)",
    "Central Tax(₹)",
    "State/UT Tax(₹)",
  ]);
  b2b.addRow(["27AAAAA0000A1Z5", "Supplier", "INV/1", "Regular", "01/08/2026", 118, "Haryana", "No", 100, 0, 9, 9]);
  return {
    purchase: Buffer.from(await purchase.xlsx.writeBuffer()),
    gst: Buffer.from(await gst.xlsx.writeBuffer()),
  };
}

describe("API workflow", () => {
  let app: ReturnType<typeof createApp>;
  let files: Awaited<ReturnType<typeof fixtureBuffers>>;
  beforeAll(async () => {
    const directory = await mkdtemp(join(tmpdir(), "gst-api-"));
    app = createApp(await createStore(directory));
    files = await fixtureBuffers();
  });

  it("validates both files and runs without MongoDB", async () => {
    const validation = await request(app)
      .post("/api/validate")
      .attach("purchase", files.purchase, "purchase.xlsx")
      .attach("gst2b", files.gst, "gstr2b.xlsx");
    expect(validation.status).toBe(200);
    expect(validation.body.purchase.records).toBe(1);
    expect(validation.body.gst.records).toBe(1);

    const response = await request(app)
      .post("/api/runs")
      .attach("purchase", files.purchase, "purchase.xlsx")
      .attach("gst2b", files.gst, "gstr2b.xlsx");
    expect(response.status).toBe(201);
    expect(response.body.summary).toMatchObject({
      reconciliationRows: 1,
      totalPr: "18.00",
      total2B: "18.00",
      difference: "0.00",
    });

    const download = await request(app).get(`/api/runs/${response.body.id}/download`);
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toContain("spreadsheetml");
    expect(Number(download.headers["content-length"])).toBeGreaterThan(1000);
  });

  it("rejects missing files, invalid archives and unsafe IDs", async () => {
    expect((await request(app).post("/api/runs").attach("purchase", files.purchase, "purchase.xlsx")).status).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/runs")
          .attach("purchase", Buffer.from("bad"), "purchase.xlsx")
          .attach("gst2b", files.gst, "gstr2b.xlsx")
      ).status,
    ).toBe(400);
    expect((await request(app).get("/api/runs/not-a-uuid")).status).toBe(400);
  });

  it("enforces configured authentication and origin checks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gst-secure-"));
    const secured = createApp(await createStore(directory), "test-secret");
    expect((await request(secured).get("/api/runs")).status).toBe(401);
    expect(
      (
        await request(secured)
          .get("/api/runs")
          .set("Authorization", "Bearer test-secret")
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get("/api/runs")
          .set("Origin", "https://untrusted.example")
      ).status,
    ).toBe(403);
  });
});
