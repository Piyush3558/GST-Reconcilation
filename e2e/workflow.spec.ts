import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";
test("simple portal: two uploads, generate, automatic Excel download", async ({
  page,
}, testInfo) => {
  test.skip(!process.env.GST_PURCHASE_PATH || !process.env.GST_2B_PATH, "Private reference fixtures are not configured");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Two files in/ }),
  ).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: /Generate reconciled Excel/ }),
  ).toBeDisabled();
  await page
    .getByLabel("Purchase register", { exact: true })
    .setInputFiles(process.env.GST_PURCHASE_PATH!);
  await page
    .getByLabel("GSTR-2B", { exact: true })
    .setInputFiles(
      process.env.GST_2B_PATH!,
    );
  await page.screenshot({
    path: testInfo.outputPath("simple-portal.png"),
    fullPage: true,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Generate reconciled Excel/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Reconciled.xlsx");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile((await download.path())!);
  expect(wb.worksheets.length).toBe(16);
  expect(wb.getWorksheet("All Results")!.rowCount).toBe(87);
  await expect(
    page.getByRole("heading", { name: /Your reconciled Excel is ready/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download again" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("simple-portal-complete.png"),
    fullPage: true,
  });
});
test("mobile portal does not overflow and retains all controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button")).toHaveCount(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
