import { Decimal } from "decimal.js";
import type { Issue } from "../shared/types.js";
export const exactInvoice = (s: string) => s.trim().toUpperCase();
export const normalizedInvoice = (s: string) =>
  exactInvoice(s).replace(/[^A-Z0-9]/g, "");
export const gstin = (s: string) => s.trim().toUpperCase();
export const validGstin = (s: string) =>
  /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s);
export function money(
  v: unknown,
  field: string,
  issues: Issue[],
  blankIsZero = false,
): string | null {
  if (v === null || v === undefined || String(v).trim() === "")
    return blankIsZero ? "0.00" : null;
  const raw = String(v).trim();
  if (
    !/^-?(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d+)?$/.test(
      raw,
    )
  ) {
    issues.push({
      code: "INVALID_AMOUNT",
      message: `Invalid numeric value for ${field}`,
      field,
      severity: "error",
    });
    return null;
  }
  const d = new Decimal(raw.replace(/,/g, ""));
  if (!d.isFinite() || d.abs().gt("9999999999999")) {
    issues.push({
      code: "INVALID_AMOUNT",
      message: `Out-of-range ${field}`,
      field,
      severity: "error",
    });
    return null;
  }
  return d.toString();
}
export function sum(values: (string | null)[]): string | null {
  return values.some((x) => x === null)
    ? null
    : values.reduce<Decimal>((a, b) => a.plus(b!), new Decimal(0)).toString();
}
export const rounded = (v: string) =>
  new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
export function dateValue(v: unknown, date1904 = false): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date)
    return Number.isFinite(v.getTime()) ? v.toISOString().slice(0, 10) : null;
  if (typeof v === "number") {
    if (
      v < (date1904 ? 0 : 1) ||
      v > 100000 ||
      (!date1904 && Math.floor(v) === 60)
    )
      return null;
    return new Date(
      Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30) +
        (Math.floor(v) + (!date1904 && v < 60 ? 1 : 0)) * 86400000,
    )
      .toISOString()
      .slice(0, 10);
  }
  const s = String(v).trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const dm = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s);
  if (iso) {
    y = +iso[1];
    m = +iso[2];
    d = +iso[3];
  } else if (dm) {
    d = +dm[1];
    m = +dm[2];
    y = +dm[3];
    if (y < 100) y += 2000;
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
    ? dt.toISOString().slice(0, 10)
    : null;
}
export function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        next[j - 1] + 1,
        row[j] + 1,
        row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return row[b.length];
}
