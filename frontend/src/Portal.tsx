import { useEffect, useRef, useState } from "react";
import type { RunResponse } from "../../shared/types";
import "./portal.css";

const serviceUnavailableMessage =
  "Reconciliation service is unavailable. Start the backend with npm run dev from the project root, then try again.";

async function readApiJson(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!body.trim()) {
    throw new Error(
      response.ok
        ? "The reconciliation service returned an empty response."
        : serviceUnavailableMessage,
    );
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(
      response.ok
        ? "The reconciliation service returned an invalid response."
        : serviceUnavailableMessage,
    );
  }
}

export default function Portal() {
  const [purchase, setPurchase] = useState<File | null>(null),
    [gst, setGst] = useState<File | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<RunResponse | null>(null),
    [downloadUrl, setDownloadUrl] = useState(""),
    [dbWarning, setDbWarning] = useState("");
  const purchaseRef = useRef<HTMLInputElement>(null),
    gstRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    fetch("/api/health")
      .then(async (response) => {
        if (!response.ok) throw new Error(serviceUnavailableMessage);
        return readApiJson(response);
      })
      .then((payload) => {
        const health = payload as { databaseWarning?: string };
        if (health.databaseWarning) setDbWarning(health.databaseWarning);
      })
      .catch(() => setDbWarning(serviceUnavailableMessage));
  }, []);
  useEffect(
    () => () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    },
    [downloadUrl],
  );
  async function generate() {
    if (!purchase || !gst) return;
    setBusy(true);
    setError("");
    setResult(null);
    setDownloadUrl("");
    try {
      const form = new FormData();
      form.append("purchase", purchase);
      form.append("gst2b", gst);
      const response = await fetch("/api/runs", { method: "POST", body: form });
      const payload = (await readApiJson(response)) as {
        error?: string;
      } & Partial<RunResponse>;
      if (!response.ok)
        throw new Error(payload.error || "Could not process the files.");
      const run = payload as RunResponse;
      const file = await fetch(`/api/runs/${run.id}/download`);
      if (!file.ok)
        throw new Error(
          "Reconciliation completed, but download failed. Please generate again.",
        );
      const url = URL.createObjectURL(await file.blob());
      setDownloadUrl(url);
      setResult(run);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Reconciled.xlsx";
      a.click();
    } catch (e) {
      setError(
        e instanceof TypeError
          ? serviceUnavailableMessage
          : e instanceof Error
            ? e.message
            : "Could not generate the workbook.",
      );
    } finally {
      setBusy(false);
    }
  }
  function choose(kind: "purchase" | "gst", file: File | null) {
    if (file && !file.name.toLowerCase().endsWith(".xlsx")) {
      setError("Please choose an .xlsx Excel workbook.");
      return;
    }
    if (file && file.size > 20 * 1024 * 1024) {
      setError("Please choose a file smaller than 20 MB.");
      return;
    }
    setError("");
    setResult(null);
    setDownloadUrl("");
    if (kind === "purchase") setPurchase(file);
    else setGst(file);
  }
  return (
    <div className="portal">
      <header className="portal-header">
        <span className="portal-mark">↔</span>
        <strong>GST Reconciliation</strong>
        <span className="header-note">Purchase register + GSTR-2B</span>
      </header>
      <main className="portal-main">
        <div className="portal-intro">
          <span className="portal-eyebrow">YOUR MONTHLY RECONCILIATION</span>
          <h1>
            Two files in.
            <br />
            Reconciled Excel out.
          </h1>
          <p>
            Upload your purchase register and GSTR-2B.
            <br />
            We’ll compare the invoices and download the results.
          </p>
        </div>
        <section className="portal-card" aria-label="Upload workbooks">
          <div className="portal-files">
            {[
              {
                id: "purchase" as const,
                title: "Purchase register",
                detail: "Excel exported from your ERP",
                file: purchase,
                ref: purchaseRef,
              },
              {
                id: "gst" as const,
                title: "GSTR-2B",
                detail: "Excel downloaded from the GST portal",
                file: gst,
                ref: gstRef,
              },
            ].map((item, i) => (
              <div
                className={`portal-file ${item.file ? "has-file" : ""}`}
                key={item.id}
              >
                <div className="file-top">
                  <span className="file-number">0{i + 1}</span>
                  <span className="excel-icon">X</span>
                </div>
                <h2>{item.title}</h2>
                <p>{item.detail}</p>
                <input
                  ref={item.ref}
                  aria-label={item.title}
                  type="file"
                  accept=".xlsx"
                  hidden
                  disabled={busy}
                  onChange={(e) => choose(item.id, e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  className="file-button"
                  disabled={busy}
                  onClick={() => item.ref.current?.click()}
                >
                  {item.file ? "Change file" : "Upload Excel"} <span>↑</span>
                </button>
                <div className="file-name" title={item.file?.name}>
                  {item.file ? (
                    <>
                      <span className="file-check">✓</span> {item.file.name}
                    </>
                  ) : (
                    "No file selected"
                  )}
                </div>
              </div>
            ))}
          </div>
          {error && (
            <p role="alert" className="portal-error">
              {error}
            </p>
          )}
          <button
            className="generate-button"
            onClick={generate}
            disabled={!purchase || !gst || busy}
          >
            {busy ? (
              <>
                <span className="spinner" /> Generating your Excel…
              </>
            ) : (
              <>
                Generate reconciled Excel <span>↓</span>
              </>
            )}
          </button>
          <p className="portal-footnote">
            .xlsx files · up to 20 MB each · originals stay unchanged
          </p>
        </section>
        {result && (
          <section className="portal-success" aria-live="polite">
            <h2>✓ Your reconciled Excel is ready</h2>
            <p>
              The download has started.{" "}
              <a href={downloadUrl} download="Reconciled.xlsx">
                Download again
              </a>
            </p>
            <div className="result-counts">
              <span>
                <strong>{result.summary.reconciliationRows}</strong> reconciled invoices
              </span>
              <span>
                <strong>{result.summary.b2bRows}</strong> B2B source rows
              </span>
              <span>
                <strong>{result.summary.unresolvedRemarks}</strong> remarks awaiting finance confirmation
              </span>
            </div>
            <p className="review-note">
              Review the Reconciliation remarks and differences before using
              the results.
            </p>
          </section>
        )}
        {dbWarning && <p className="database-note">{dbWarning}</p>}
        <footer className="portal-bottom">
          Supplier GSTIN + invoice matching <span>·</span> Tax differences{" "}
          <span>·</span> PR, B2B and Reconciliation sheets
        </footer>
      </main>
    </div>
  );
}
