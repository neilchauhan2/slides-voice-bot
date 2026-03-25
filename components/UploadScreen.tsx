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
      </div>
    </div>
  );
}
