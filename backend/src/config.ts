import "dotenv/config";
import { z } from "zod";
import { defaultPolicy } from "./engine.js";
import type { Policy } from "../../shared/types.js";
const decimal = z.string().regex(/^\d{1,5}(?:\.\d{1,2})?$/);
export const configuredPolicy: Policy = {
  ...defaultPolicy,
  totalTolerance: decimal.parse(
    process.env.TOTAL_TAX_TOLERANCE ?? defaultPolicy.totalTolerance,
  ),
  componentTolerance: decimal.parse(
    process.env.COMPONENT_TOLERANCE ?? defaultPolicy.componentTolerance,
  ),
  taxableTolerance: decimal.parse(
    process.env.TAXABLE_TOLERANCE ?? defaultPolicy.taxableTolerance,
  ),
  invoiceValueTolerance: decimal.parse(
    process.env.INVOICE_VALUE_TOLERANCE ?? defaultPolicy.invoiceValueTolerance,
  ),
};
