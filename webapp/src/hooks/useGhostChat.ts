import { useState, useEffect, useRef, useCallback } from "react";
import { RING_DURATION_MS } from "../theme";
import {
  GhostConnection,
  type ConnectionStatus,
  type GhostMessage,
  type VerificationCode,
} from "../network/GhostConnection";

export interface GhostChatState {
  status:       ConnectionStatus;
  messages:     GhostMessage[];
  verification: VerificationCode | null;
  error:        string | null;
  isSecure:     boolean;
  ringAcked:    boolean;          // true for RING_DURATION_MS after ring is sent/acked
  send:         (text: string) => Promise<void>;
  ring:         () => void;
  end:          () => void;
}

export function useGhostChat(
  roomId: string,
  role: "client" | "admin" = "client",
  adminToken = ""
): GhostChatState {
  const [status,       setStatus]       = useState<ConnectionStatus>("idle");
  const [messages,     setMessages]     = useState<GhostMessage[]>([]);
  const [verification, setVerification] = useState<VerificationCode | null>(null);
  const [error,        setError]        = useState<string | null>(null);
  const [isSecure,     setIsSecure]     = useState(false);
  const [ringAcked,    setRingAcked]    = useState(false);

  const connRef         = useRef<GhostConnection | null>(null);
  const ringTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Helper: set ringAcked=true for RING_DURATION_MS, then reset.
  // Safe to call on unmounted component because the timer is cleared in cleanup.
  function triggerRingFeedback() {
    if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
    setRingAcked(true);
    ringTimerRef.current = setTimeout(() => setRingAcked(false), RING_DURATION_MS);
  }

  useEffect(() => {
    if (!roomId) return;

    const conn = new GhostConnection(
      roomId,
      {
        onStatus:       (s) => setStatus(s),
        onMessage:      (m) => setMessages((prev) => [...prev, m]),
        onVerification: (code) => setVerification(code),
        onError:        (msg) => setError(msg),
        onSecure:       (s) => setIsSecure(s),
        onRingAck:      () => triggerRingFeedback(),
      },
      role,
      adminToken
    );
    connRef.current = conn;

    conn.connect().catch((err) => {
      setError(String(err));
      setStatus("error");
    });

    return () => {
      conn.close("component_unmount");
      // Clear pending ring timer to avoid setState on unmounted component
      if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
    };
  }, [roomId, role, adminToken]);

  const send = useCallback(async (text: string) => {
    await connRef.current?.sendMessage(text);
  }, []);

  const ring = useCallback(() => {
    connRef.current?.ring();
    triggerRingFeedback(); // immediate feedback, before server ack
  }, []);

  const end = useCallback(() => {
    connRef.current?.close("user_ended");
  }, []);

  return { status, messages, verification, error, isSecure, ringAcked, send, ring, end };
}
