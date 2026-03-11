import { useState, useEffect, useRef, useCallback } from "react";
import { wsUrl, playBell, NOTIF_CAP } from "../theme";

export interface AdminSession {
  roomId: string;
  secure: boolean;
  clientCode: string;
  clientLabel?: string;
  peers: number;
  createdAt: number;
}

export interface AdminCode {
  code: string;
  label: string;
  createdAt: number;
}

export type AdminNotif =
  | { type: "client_waiting"; roomId: string; code: string; secure: boolean; label?: string; ts: number }
  | { type: "client_ring";    roomId: string; code: string; label?: string; ts: number }
  | { type: "session_ended";  roomId: string; ts: number }
  | { type: "peer_left";      roomId: string; ts: number };

export interface AdminSocketState {
  connected: boolean;
  sessions: AdminSession[];
  codes: AdminCode[];
  notifs: AdminNotif[];
  insecureCode: string;
  endSession:  (roomId: string) => void;
  createCode:  (code: string, label: string) => Promise<void>;
  deleteCode:  (code: string) => Promise<void>;
  clearNotifs: () => void;
}

const MAX_RECONNECT_DELAY_MS = 30_000;

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function useAdminSocket(token: string): AdminSocketState {
  const [connected,    setConnected]    = useState(false);
  const [sessions,     setSessions]     = useState<AdminSession[]>([]);
  const [codes,        setCodes]        = useState<AdminCode[]>([]);
  const [notifs,       setNotifs]       = useState<AdminNotif[]>([]);
  const [insecureCode, setInsecureCode] = useState("00000");

  const wsRef          = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(1_000);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted      = useRef(false);

  // ── Main effect: REST seed + WS connect with auto-reconnect ───────────────
  useEffect(() => {
    if (!token) return;
    unmounted.current = false;

    const controller = new AbortController();
    const { signal } = controller;
    const headers = authHeaders(token);

    // Parallel initial seed via REST (resilient to WS timing issues)
    Promise.all([
      fetch("/admin/sessions", { headers, signal })
        .then((r) => r.json())
        .then((d) => { if (!unmounted.current) setSessions(d.sessions ?? []); }),
      fetch("/admin/codes", { headers, signal })
        .then((r) => r.json())
        .then((d) => { if (!unmounted.current) setCodes(d.codes ?? []); }),
    ]).catch(() => { /* aborted or network error — WS will fill in */ });

    function connect() {
      if (unmounted.current) return;

      const ws = new WebSocket(wsUrl(`/admin-ws?token=${token}`));
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current !== ws) { ws.close(); return; } // stale socket
        setConnected(true);
        reconnectDelay.current = 1_000; // reset backoff
      };

      ws.onclose = () => {
        if (wsRef.current !== ws) return; // stale socket — ignore
        setConnected(false);
        if (!unmounted.current) {
          reconnectTimer.current = setTimeout(() => {
            reconnectDelay.current = Math.min(reconnectDelay.current * 2, MAX_RECONNECT_DELAY_MS);
            connect();
          }, reconnectDelay.current);
        }
      };

      ws.onmessage = (ev) => {
        if (wsRef.current !== ws) return; // stale socket — ignore
        const ts = Date.now();
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(ev.data as string); } catch { return; }

        switch (msg.type) {
          case "admin_connected":
            setInsecureCode((msg.insecureCode as string) ?? "00000");
            break;

          case "sessions_list":
            // Merge incoming with existing (avoids clobbering REST-seeded state)
            setSessions((prev) => {
              const incoming = (msg.sessions as AdminSession[]) ?? [];
              if (!incoming.length) return prev;
              const map = new Map(prev.map((s) => [s.roomId, s]));
              for (const s of incoming) map.set(s.roomId, s);
              return Array.from(map.values());
            });
            break;

          case "codes_list":
            setCodes((prev) => {
              const incoming = (msg.codes as AdminCode[]) ?? [];
              if (!incoming.length) return prev;
              const map = new Map(prev.map((c) => [c.code, c]));
              for (const c of incoming) map.set(c.code, c);
              return Array.from(map.values());
            });
            break;

          case "client_waiting":
            setSessions((prev) => {
              if (prev.find((s) => s.roomId === msg.roomId)) return prev;
              return [
                ...prev,
                {
                  roomId:      msg.roomId      as string,
                  secure:      Boolean(msg.secure),
                  clientCode:  msg.code        as string,
                  clientLabel: msg.label       as string | undefined,
                  peers:       1,
                  createdAt:   msg.createdAt   as number ?? ts,
                },
              ];
            });
            pushNotif({ type: "client_waiting", roomId: msg.roomId as string, code: msg.code as string, secure: Boolean(msg.secure), label: msg.label as string | undefined, ts });
            break;

          case "client_ring":
            playBell();
            pushNotif({ type: "client_ring", roomId: msg.roomId as string, code: msg.code as string, label: msg.label as string | undefined, ts });
            break;

          case "session_ended":
            setSessions((prev) => prev.filter((s) => s.roomId !== msg.roomId));
            pushNotif({ type: "session_ended", roomId: msg.roomId as string, ts });
            break;

          case "peer_left":
            setSessions((prev) =>
              prev.map((s) =>
                s.roomId === msg.roomId ? { ...s, peers: Math.max(0, s.peers - 1) } : s
              )
            );
            pushNotif({ type: "peer_left", roomId: msg.roomId as string, ts });
            break;
        }
      };
    }

    connect();

    return () => {
      unmounted.current = true;
      controller.abort();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [token]);

  // Cap notifs to prevent unbounded growth
  function pushNotif(n: AdminNotif) {
    setNotifs((prev) => [n, ...prev].slice(0, NOTIF_CAP));
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  const endSession = useCallback((roomId: string) => {
    wsRef.current?.send(JSON.stringify({ type: "end_session", roomId }));
    setSessions((prev) => prev.filter((s) => s.roomId !== roomId));
  }, []);

  const createCode = useCallback(async (code: string, label: string) => {
    const res = await fetch("/admin/codes", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify({ code, label }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error ?? "Erreur serveur");
    }
    const data = await res.json() as AdminCode;
    setCodes((prev) => {
      if (prev.find((c) => c.code === data.code)) return prev;
      return [...prev, { code: data.code, label: data.label, createdAt: Date.now() }];
    });
  }, [token]);

  const deleteCode = useCallback(async (code: string) => {
    await fetch(`/admin/codes/${code}`, {
      method: "DELETE",
      headers: authHeaders(token),
    }).catch(() => {});
    setCodes((prev) => prev.filter((c) => c.code !== code));
  }, [token]);

  const clearNotifs = useCallback(() => setNotifs([]), []);

  return { connected, sessions, codes, notifs, insecureCode, endSession, createCode, deleteCode, clearNotifs };
}
