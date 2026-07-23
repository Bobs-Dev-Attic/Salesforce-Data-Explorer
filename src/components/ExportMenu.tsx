"use client";

import { useEffect, useRef, useState } from "react";

export type ExportFormat = "csv" | "tsv" | "xlsx" | "json";

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "csv", label: "CSV" },
  { value: "tsv", label: "Tab-delimited (.tsv)" },
  { value: "xlsx", label: "Excel (.xlsx)" },
  { value: "json", label: "JSON" },
];

/**
 * Export split into a single dropdown button: click reveals the format options,
 * choosing one runs the export in that format. Closes on outside click / Escape.
 */
export default function ExportMenu({
  disabled,
  exporting,
  onExport,
  label = "Export",
}: {
  disabled?: boolean;
  exporting?: boolean;
  onExport: (format: ExportFormat) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="dropdown" ref={ref}>
      <button
        className="btn secondary"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || exporting}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {exporting ? "Exporting…" : `${label} ▾`}
      </button>
      {open && (
        <div className="dropdown-menu" role="menu">
          {FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="menuitem"
              className="dropdown-item"
              onClick={() => {
                setOpen(false);
                onExport(f.value);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
