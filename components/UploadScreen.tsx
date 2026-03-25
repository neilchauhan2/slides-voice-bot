"use client";

import { useRouter } from "next/navigation";
import { type DragEvent, useMemo, useState } from "react";

type UploadState = "idle" | "uploading" | "error";

export function UploadScreen() {
  const router = useRouter();
  const [state, setState] = useState<UploadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const label = useMemo(() => {
    if (state === "uploading") {
      return "Extracting slides...";
    }
    if (dragging) {
      return "Drop your PDF here";
    }
    return "Drop a PDF or click to upload";
  }, [dragging, state]);

  async function submitDefaultPdf(pdfId: "ml" | "product_management") {
    setState("uploading");
    setError(null);

    const formData = new FormData();
    formData.append("defaultPdf", pdfId);

    try {
      const response = await fetch("/api/process-pdf", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();

      if (!response.ok || !payload.sessionId) {
        setState("error");
        setError(payload.error ?? "Failed to process PDF");
        return;
      }

      const params = new URLSearchParams({
        session: payload.sessionId,
      });

      if (payload.vapiAssistantId) {
        params.set("assistantId", payload.vapiAssistantId);
      }

      router.push(`/present?${params.toString()}`);
    } catch (e) {
      setState("error");
      setError("Failed to process default PDF");
    }
  }

  async function submitFile(file: File) {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setState("error");
      setError("Please upload a .pdf file.");
      return;
    }

    setState("uploading");
    setError(null);

    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/process-pdf", {
      method: "POST",
      body: formData,
    });

    const payload = (await response.json()) as {
      sessionId?: string;
      vapiAssistantId?: string | null;
      error?: string;
    };

    if (!response.ok || !payload.sessionId) {
      setState("error");
      setError(payload.error ?? "Failed to process PDF");
      return;
    }

    const params = new URLSearchParams({
      session: payload.sessionId,
    });

    if (payload.vapiAssistantId) {
      params.set("assistantId", payload.vapiAssistantId);
    }

    router.push(`/present?${params.toString()}`);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);

    const file = event.dataTransfer.files?.[0];
    if (file) {
      void submitFile(file);
    }
  }

  return (
    <div className="upload-wrap">
      <div className="upload-card">
        <p className="upload-kicker">Slides Voice Bot</p>
        <h1>Runtime PDF Presentation Player</h1>
        <p className="upload-sub">
          Text-first parsing only. Upload one PDF and get a session-specific voice presenter.
        </p>

        <label
          className={`drop-zone ${dragging ? "is-dragging" : ""} ${state === "uploading" ? "is-busy" : ""}`}
          onDrop={onDrop}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
        >
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={state === "uploading"}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void submitFile(file);
              }
            }}
          />
          <span>{label}</span>
        </label>

        {state === "uploading" && <div className="spinner" aria-label="Loading" />}
        {error && <p className="upload-error">{error}</p>}

        <div style={{ marginTop: '3.5rem' }}>
          <h2 style={{ fontSize: '1.2rem', fontFamily: 'var(--font-title)', marginBottom: '1.2rem', textAlign: 'center', color: 'var(--ink-200)' }}>
            Present an existing presentation
          </h2>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <div style={{ border: '1px solid color-mix(in srgb, var(--ink-200) 25%, transparent)', padding: '1.2rem', borderRadius: '14px', textAlign: 'left', flex: "1 1 200px", background: 'color-mix(in srgb, var(--base-700) 40%, transparent)' }}>
              <h3 style={{ fontSize: '1.1rem', margin: '0 0 0.5rem', fontFamily: 'var(--font-title)' }}>Product Management</h3>
              <p style={{ fontSize: '0.85rem', color: 'color-mix(in srgb, var(--ink-200) 80%, transparent)', margin: '0 0 1rem', lineHeight: 1.4 }}>Example slide deck about Product Management best practices.</p>
              <button
                onClick={() => submitDefaultPdf("product_management")}
                disabled={state === "uploading"}
                style={{ padding: '0.55rem 1rem', background: 'var(--mint)', color: '#000', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, width: '100%', fontFamily: 'var(--font-title)' }}
              >
                Present
              </button>
            </div>
            <div style={{ border: '1px solid color-mix(in srgb, var(--ink-200) 25%, transparent)', padding: '1.2rem', borderRadius: '14px', textAlign: 'left', flex: "1 1 200px", background: 'color-mix(in srgb, var(--base-700) 40%, transparent)' }}>
              <h3 style={{ fontSize: '1.1rem', margin: '0 0 0.5rem', fontFamily: 'var(--font-title)' }}>Machine Learning</h3>
              <p style={{ fontSize: '0.85rem', color: 'color-mix(in srgb, var(--ink-200) 80%, transparent)', margin: '0 0 1rem', lineHeight: 1.4 }}>Example slide deck about basics of Machine Learning.</p>
              <button
                onClick={() => submitDefaultPdf("ml")}
                disabled={state === "uploading"}
                style={{ padding: '0.55rem 1rem', background: 'var(--mint)', color: '#000', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, width: '100%', fontFamily: 'var(--font-title)' }}
              >
                Present
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
