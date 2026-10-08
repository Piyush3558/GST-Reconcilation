import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";

async function files() {
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

test("two uploads generate one three-sheet reconciled workbook", async ({ page }, testInfo) => {
  const fixture = await files();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Two files in/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Generate reconciled Excel/ })).toBeDisabled();
  await page.getByLabel("Purchase register", { exact: true }).setInputFiles({
    name: "purchase.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: fixture.purchase,
  });
  await page.getByLabel("GSTR-2B", { exact: true }).setInputFiles({
    name: "gstr2b.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: fixture.gst,
  });
  await page.screenshot({ path: testInfo.outputPath("portal-ready.png"), fullPage: true });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Generate reconciled Excel/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Reconciled.xlsx");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await download.path())!);
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
    "PR",
    "B2B",
    "Reconciliation",
  ]);
  expect(workbook.getWorksheet("Reconciliation")!.columnCount).toBe(12);
  await expect(page.getByRole("heading", { name: /Your reconciled Excel is ready/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile portal does not overflow and retains all controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button")).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("reports an unavailable backend without exposing a JSON parse error", async ({ page }) => {
  const fixture = await files();
  await page.route("**/api/runs", (route) =>
    route.fulfill({ status: 502, body: "" }),
  );
  await page.goto("/");
  await page.getByLabel("Purchase register", { exact: true }).setInputFiles({
    name: "purchase.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: fixture.purchase,
  });
  await page.getByLabel("GSTR-2B", { exact: true }).setInputFiles({
    name: "gstr2b.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: fixture.gst,
  });
  await page.getByRole("button", { name: /Generate reconciled Excel/ }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Reconciliation service is unavailable",
  );
  await expect(page.getByRole("alert")).not.toContainText("JSON");
});
