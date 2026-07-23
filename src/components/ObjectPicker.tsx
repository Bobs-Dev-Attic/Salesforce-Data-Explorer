"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePersistentState } from "@/lib/usePersistentState";
import { useFocusTrap } from "@/lib/useFocusTrap";

export interface GlobalObject {
  name: string;
  label: string;
  queryable: boolean;
  custom: boolean;
}

/**
 * Object combobox with:
 *  - a single controlled input (so it clears normally),
 *  - recent objects surfaced first in the autocomplete,
 *  - a directory button that opens a browse-all-objects dialog.
 */
export default function ObjectPicker({
  objects,
  value,
  onSelect,
  id = "obj",
  placeholder = "Type to search…",
  queryableOnly = false,
}: {
  objects: GlobalObject[];
  value: string;
  onSelect: (name: string) => void;
  id?: string;
  placeholder?: string;
  queryableOnly?: boolean;
}) {
  const [text, setText] = useState(value || "");
  const [dirOpen, setDirOpen] = useState(false);
  const [recents, setRecents] = usePersistentState<string[]>(
    "sfde.recentObjects",
    []
  );
  const listId = `${id}-list`;

  // Keep the input in sync when the selection changes externally.
  useEffect(() => {
    setText(value || "");
  }, [value]);

  const pool = useMemo(
    () => (queryableOnly ? objects.filter((o) => o.queryable) : objects),
    [objects, queryableOnly]
  );
  const byName = useMemo(() => {
    const m = new Map<string, GlobalObject>();
    for (const o of pool) m.set(o.name, o);
    return m;
  }, [pool]);

  function select(name: string) {
    onSelect(name);
    setText(name);
    setRecents((prev) => [name, ...prev.filter((n) => n !== name)].slice(0, 12));
    setDirOpen(false);
  }

  function commit(v: string) {
    const m = pool.find(
      (o) => o.name.toLowerCase() === v.trim().toLowerCase()
    );
    if (m) select(m.name);
  }

  // Datalist options: matching recents first, then the rest.
  const options = useMemo(() => {
    const f = text.trim().toLowerCase();
    const recentMatches = recents.filter(
      (n) => byName.has(n) && (!f || n.toLowerCase().includes(f))
    );
    const seen = new Set(recentMatches);
    const rest = pool
      .filter(
        (o) =>
          !seen.has(o.name) &&
          (!f ||
            o.name.toLowerCase().includes(f) ||
            o.label.toLowerCase().includes(f))
      )
      .map((o) => o.name);
    return [...recentMatches, ...rest].slice(0, 200);
  }, [pool, byName, recents, text]);

  return (
    <div className="objpicker">
      <div className="objpicker-row">
        <input
          id={id}
          list={listId}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            commit(e.target.value);
          }}
          onBlur={(e) => commit(e.target.value)}
        />
        <datalist id={listId}>
          {options.map((n) => (
            <option key={n} value={n}>
              {byName.get(n)?.label}
            </option>
          ))}
        </datalist>
        <button
          type="button"
          className="btn secondary objpicker-dir"
          title="Browse all objects"
          aria-label="Browse all objects"
          onClick={() => setDirOpen(true)}
        >
          🗂️
        </button>
      </div>

      {dirOpen && (
        <ObjectDirectory
          pool={pool}
          recents={recents.filter((n) => byName.has(n))}
          onSelect={select}
          onClose={() => setDirOpen(false)}
        />
      )}
    </div>
  );
}

function ObjectDirectory({
  pool,
  recents,
  onSelect,
  onClose,
}: {
  pool: GlobalObject[];
  recents: string[];
  onSelect: (name: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, onClose);
  const byName = useMemo(() => {
    const m = new Map<string, GlobalObject>();
    for (const o of pool) m.set(o.name, o);
    return m;
  }, [pool]);

  const { standard, custom } = useMemo(() => {
    const f = q.trim().toLowerCase();
    const match = (o: GlobalObject) =>
      !f || o.name.toLowerCase().includes(f) || o.label.toLowerCase().includes(f);
    const std: GlobalObject[] = [];
    const cus: GlobalObject[] = [];
    for (const o of pool) {
      if (!match(o)) continue;
      (o.custom ? cus : std).push(o);
    }
    std.sort((a, b) => a.label.localeCompare(b.label));
    cus.sort((a, b) => a.label.localeCompare(b.label));
    return { standard: std, custom: cus };
  }, [pool, q]);

  function Item({ o }: { o: GlobalObject }) {
    return (
      <div
        className="list-item"
        role="button"
        tabIndex={0}
        aria-label={`${o.label} (${o.name})${o.custom ? ", custom object" : ""}`}
        onClick={() => onSelect(o.name)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(o.name);
          }
        }}
      >
        <span className="lbl">{o.label}</span>{" "}
        <span className="api">
          {o.name}
          {o.custom ? " · custom" : ""}
        </span>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Object directory"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 style={{ margin: 0, fontSize: 18 }}>Object directory</h2>
          <button className="linkbtn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body" style={{ padding: "12px 18px" }}>
          <input
            autoFocus
            placeholder="Search objects…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          {recents.length > 0 && !q.trim() && (
            <>
              <h3 className="dir-h">Recent</h3>
              <div className="list" style={{ marginBottom: 12 }}>
                {recents.map((n) =>
                  byName.get(n) ? <Item key={n} o={byName.get(n)!} /> : null
                )}
              </div>
            </>
          )}
          <h3 className="dir-h">Standard Objects · {standard.length}</h3>
          <div className="list" style={{ maxHeight: 220, marginBottom: 12 }}>
            {standard.map((o) => (
              <Item key={o.name} o={o} />
            ))}
            {standard.length === 0 && (
              <div className="list-item muted">No matches</div>
            )}
          </div>
          <h3 className="dir-h">Custom Objects · {custom.length}</h3>
          <div className="list" style={{ maxHeight: 220 }}>
            {custom.map((o) => (
              <Item key={o.name} o={o} />
            ))}
            {custom.length === 0 && (
              <div className="list-item muted">No matches</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
