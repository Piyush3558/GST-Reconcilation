import express from "express";
import helmet from "helmet";
import multer from "multer";
import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { parse } from "./parser.js";
import { approveCandidate, defaultPolicy, reconcile } from "./engine.js";
import { exportWorkbook } from "./workbook.js";
import type { Store } from "./store.js";
import type { Policy } from "../shared/types.js";
import { configuredPolicy } from "./config.js";
const decimal = z.string().regex(/^\d{1,5}(?:\.\d{1,2})?$/);
const policySchema = z.object({
  totalTolerance: decimal,
  componentTolerance: decimal,
  taxableTolerance: decimal,
  invoiceValueTolerance: decimal,
  punctuationMatching: z.boolean(),
});
const uuid = z.string().uuid();
export function createApp(
  store: Store,
  token = "",
  dist = resolve("dist"),
  databaseWarning = "",
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "script-src": ["'self'"],
          "connect-src": ["'self'"],
          "img-src": ["'self'", "data:"],
        },
      },
    }),
  );
  app.use(express.json({ limit: "32kb" }));
  app.use("/api", (req, res, next) => {
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        if (
          !["localhost", "127.0.0.1"].includes(origin.hostname) &&
          origin.host !== req.get("host")
        ) {
          res.status(403).json({ error: "Origin not allowed" });
          return;
        }
      } catch {
        res.status(403).json({ error: "Invalid origin" });
        return;
      }
    }
    if (token) {
      const supplied = Buffer.from(
        req.headers.authorization?.replace(/^Bearer /, "") ?? "",
      );
      const expected = Buffer.from(token);
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      ) {
        res.status(401).json({ error: "Access token required" });
        return;
      }
    }
    next();
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024, files: 2, fields: 2, parts: 4 },
    fileFilter: (_req, file, cb) => {
      if (!/\.xlsx$/i.test(file.originalname)) {
        cb(new Error("Only .xlsx files are supported"));
        return;
      }
      cb(null, true);
    },
  }).fields([
    { name: "purchase", maxCount: 1 },
    { name: "gst2b", maxCount: 1 },
  ]);
  // One in-process mutation at a time avoids review/update races in the single-worker deployment.
  let busy = false;
  const exclusive =
    (
      handler: (req: express.Request, res: express.Response) => Promise<void>,
    ): express.RequestHandler =>
    async (req, res, next) => {
      if (busy) {
        res.status(409).json({
          error: "Another operation is running. Retry when it finishes.",
        });
        return;
      }
      busy = true;
      try {
        await handler(req, res);
      } catch (error) {
        next(error);
      } finally {
        busy = false;
      }
    };
  app.get("/api/health", (_req, res) =>
    res.json({
      status: "ok",
      storage: store.kind,
      policy: configuredPolicy,
      databaseWarning,
    }),
  );
  app.get("/api/runs", async (_req, res) => res.json(await store.list()));
  app.post(
    "/api/validate",
    upload,
    exclusive(async (req, res) => {
      const files = req.files as Record<string, Express.Multer.File[]>;
      const p = files?.purchase?.[0],
        g = files?.gst2b?.[0];
      if (!p || !g) {
        res.status(400).json({ error: "Upload both workbooks." });
        return;
      }
      const [purchase, gst] = await Promise.all([
        parse(p.buffer, p.originalname, "PURCHASE"),
        parse(g.buffer, g.originalname, "GSTR2B"),
      ]);
      res.json({
        purchase: {
          filename: purchase.filename,
          records: purchase.documents.length,
          sheets: purchase.sheets,
          issues: purchase.issues,
        },
        gst: {
          filename: gst.filename,
          records: gst.documents.length,
          sheets: gst.sheets,
          issues: gst.issues,
        },
      });
    }),
  );
  app.post(
    "/api/runs",
    upload,
    exclusive(async (req, res) => {
      const files = req.files as Record<string, Express.Multer.File[]>;
      const p = files?.purchase?.[0],
        g = files?.gst2b?.[0];
      if (!p || !g) {
        res.status(400).json({ error: "Upload both workbooks." });
        return;
      }
      let settings: Policy = configuredPolicy;
      if (req.body.policy) {
        let json: unknown;
        try {
          json = JSON.parse(req.body.policy);
        } catch {
          res.status(400).json({ error: "Invalid policy JSON" });
          return;
        }
        settings = { ...configuredPolicy, ...policySchema.parse(json) };
      }
      const [purchase, gst] = await Promise.all([
        parse(p.buffer, p.originalname, "PURCHASE"),
        parse(g.buffer, g.originalname, "GSTR2B"),
      ]);
      const run = reconcile(purchase, gst, settings);
      await store.save(run);
      res.status(201).json(run);
    }),
  );
  app.get("/api/runs/:id", async (req, res) => {
    const id = uuid.parse(req.params.id);
    const run = await store.get(id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json(run);
  });
  app.get("/api/runs/:id/download", async (req, res) => {
    const id = uuid.parse(req.params.id);
    const run = await store.get(id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.set(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.set(
      "Content-Disposition",
      `attachment; filename="Reconciled_${id.slice(0, 8)}.xlsx"`,
    );
    res.send(await exportWorkbook(run));
  });
  app.post(
    "/api/runs/:id/approve",
    exclusive(async (req, res) => {
      const id = uuid.parse(req.params.id);
      const input = z
        .object({
          purchaseId: z.string().min(1).max(250),
          gstId: z.string().min(1).max(250),
          actor: z.string().trim().min(2).max(100),
          reason: z.string().trim().min(8).max(1000),
        })
        .parse(req.body);
      const run = await store.get(id);
      if (!run) {
        res.status(404).json({ error: "Run not found" });
        return;
      }
      let next;
      try {
        next = approveCandidate(
          run,
          input.purchaseId,
          input.gstId,
          input.actor,
          input.reason,
        );
      } catch {
        res
          .status(409)
          .json({ error: "Candidate unavailable or already reviewed." });
        return;
      }
      await store.save(next);
      res.json(next);
    }),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Endpoint not found" }),
  );
  app.use(express.static(dist));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve(dist, "index.html")));
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          error: "Invalid request",
          issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        });
        return;
      }
      if (err instanceof multer.MulterError) {
        res.status(400).json({
          error: "Upload rejected: file size, count or field limit exceeded.",
        });
        return;
      }
      const message = err instanceof Error ? err.message : "";
      const safe =
        /^(Upload|Only|Workbook|Expanded|Macros|Not an|No supported|No transaction|Required columns|Cannot identify|Candidate|Invalid (workbook|origin))/i.test(
          message,
        );
      res.status(safe ? 400 : 500).json({
        error: safe
          ? message
          : "Operation failed. Check the workbook format or service configuration.",
      });
    },
  );
  return app;
}
