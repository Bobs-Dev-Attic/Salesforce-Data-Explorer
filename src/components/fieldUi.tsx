"use client";

import React, { useRef } from "react";
import { useFocusTrap } from "@/lib/useFocusTrap";

/** Small funnel icon used on filterable column headers. */
export function FunnelIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={{ verticalAlign: "middle" }}
    >
      <path
        d="M1.5 2.5h13L9.5 8.5v4l-3 1.5V8.5z"
        fill={active ? "var(--accent)" : "none"}
        stroke={active ? "var(--accent)" : "currentColor"}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Modal showing the full describe metadata of a single field (two columns). */
export function FieldMetadataDialog({
  field,
  onClose,
}: {
  field: Record<string, unknown>;
  onClose: () => void;
}) {
  const priority = [
    "label",
    "name",
    "type",
    "length",
    "precision",
    "scale",
    "nillable",
    "createable",
    "updateable",
    "unique",
    "externalId",
    "custom",
    "calculated",
    "defaultValue",
    "referenceTo",
    "relationshipName",
    "inlineHelpText",
    "picklistValues",
  ];
  const keys = Object.keys(field);
  const ordered = [
    ...priority.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !priority.includes(k)).sort(),
  ];
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, onClose);

  function renderValue(key: string, value: unknown): React.ReactNode {
    if (value === null || value === undefined || value === "") return "—";
    if (key === "picklistValues" && Array.isArray(value)) {
      const vals = value as {
        value: string;
        label?: string;
        active?: boolean;
      }[];
      if (vals.length === 0) return "—";
      return (
        <div style={{ maxHeight: 160, overflow: "auto" }}>
          {vals.map((p, i) => (
            <div key={i} className="api">
              {p.value}
              {p.label && p.label !== p.value ? ` — ${p.label}` : ""}
              {p.active === false ? " (inactive)" : ""}
            </div>
          ))}
        </div>
      );
    }
    if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "object") return <code>{JSON.stringify(value)}</code>;
    return String(value);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Field details: ${String(field.label ?? field.name)}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 style={{ margin: 0, fontSize: 18 }}>
            {String(field.label ?? field.name)}{" "}
            <span className="muted" style={{ fontSize: 13 }}>
              ({String(field.name)})
            </span>
          </h2>
          <button className="linkbtn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="meta-grid">
            {ordered.map((k) => {
              const v = field[k];
              const fullWidth =
                k === "picklistValues" ||
                (typeof v === "object" && v !== null && !Array.isArray(v));
              return (
                <div key={k} className={`meta-item${fullWidth ? " full" : ""}`}>
                  <div className="meta-key">{k}</div>
                  <div className="meta-val">{renderValue(k, v)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
