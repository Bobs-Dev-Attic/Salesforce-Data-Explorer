"use client";

import { useEffect, useState } from "react";

interface Conn {
  id: string;
  username: string | null;
  label: string | null;
  instance_url: string;
  is_active: boolean;
}

/**
 * Compact active-connection indicator + switcher for the top bar. Shows the
 * active org; when more than one connection exists, offers a dropdown to switch.
 * Activating reloads so server + client data re-read the new connection.
 */
export default function ConnectionSwitcher() {
  const [conns, setConns] = useState<Conn[]>([]);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/salesforce/connections");
        const data = await res.json();
        if (res.ok) setConns(data.connections || []);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  if (!conns.length) return null;

  const active = conns.find((c) => c.is_active) || conns[0];
  const nameOf = (c: Conn) => c.username || c.label || c.instance_url;

  async function switchTo(id: string) {
    if (!id || id === active?.id) return;
    setSwitching(true);
    try {
      await fetch(`/api/salesforce/connections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate" }),
      });
      window.location.reload();
    } catch {
      setSwitching(false);
    }
  }

  return (
    <div className="conn-switcher" title={active?.instance_url}>
      <span className="conn-dot" />
      {conns.length > 1 ? (
        <select
          aria-label="Active Salesforce connection"
          value={active?.id}
          disabled={switching}
          onChange={(e) => switchTo(e.target.value)}
        >
          {conns.map((c) => (
            <option key={c.id} value={c.id}>
              {nameOf(c)}
            </option>
          ))}
        </select>
      ) : (
        <span className="conn-name">{active ? nameOf(active) : ""}</span>
      )}
    </div>
  );
}
