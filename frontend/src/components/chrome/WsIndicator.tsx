/* WsIndicator — top-right flash on WebSocket view-invalidate events.
 *
 * Subscribes to `view:invalidate` from the real wsClient (not a custom event)
 * and flashes the affected viewKinds for ~2.6s. Visible only when at least
 * one recent event is still animating. */

import { useEffect, useState } from "react";
import { wsClient } from "../../services/wsClient";

interface Stamp {
  id: number;
  viewKinds: string[];
  t: number;
}

export default function WsIndicator() {
  const [recent, setRecent] = useState<Stamp[]>([]);

  useEffect(() => {
    let counter = 0;
    const unsub = wsClient.subscribe("view:invalidate", (payload) => {
      const viewKinds: string[] = Array.isArray((payload as { viewKinds?: unknown })?.viewKinds)
        ? ((payload as { viewKinds: string[] }).viewKinds)
        : [];
      const id = ++counter;
      const stamp: Stamp = { id, viewKinds, t: Date.now() };
      setRecent((r) => [stamp, ...r].slice(0, 4));
      window.setTimeout(() => {
        setRecent((r) => r.filter((x) => x.id !== id));
      }, 2600);
    });
    return unsub;
  }, []);

  if (recent.length === 0) return null;
  return (
    <div
      data-testid="ws-indicator"
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 58,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      {recent.map((r) => (
        <div
          key={r.id}
          style={{
            background: "var(--navy-deep)",
            color: "var(--white)",
            borderRadius: "var(--r-md)",
            padding: "6px 10px",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            animation: "ns-slide-up .18s ease",
            boxShadow: "var(--shadow-2)",
          }}
        >
          <span
            style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--gold-bright)" }}
          />
          <span>WS view:invalidate</span>
          <span style={{ color: "var(--gold-bright)" }}>
            → {r.viewKinds.join(", ") || "none"}
          </span>
        </div>
      ))}
    </div>
  );
}
