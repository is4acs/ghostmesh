import React, { useState, useRef, useEffect, useCallback } from "react";
import { useGhostChat } from "../hooks/useGhostChat";
import {
  ACCENT, BG, BG2, BG3, RED, ORANGE, FONT,
  formatTime, copyToClipboard, errorBoxStyle, badgeStyle,
} from "../theme";

// ─── Status maps (module-level: allocated once) ───────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  idle:        "EN ATTENTE",
  connecting:  "CONNEXION...",
  signaling:   "SIGNALING...",
  handshaking: "HANDSHAKE ECDH...",
  secure:      "SÉCURISÉ ◆",
  closed:      "SESSION TERMINÉE",
  error:       "ERREUR",
};

const STATUS_COLORS: Record<string, string> = {
  idle:        "#666",
  connecting:  "#888",
  signaling:   "#aaa",
  handshaking: ACCENT,
  secure:      ACCENT,
  closed:      RED,
  error:       RED,
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface AdminInfo {
  code:   string;
  label?: string;
  token:  string;
}

interface Props {
  roomId:    string;
  role:      "client" | "admin";
  secure:    boolean;
  adminInfo?: AdminInfo;     // only when role === "admin"
  onBack:    () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ChatApp({ roomId, role, secure, adminInfo, onBack }: Props) {
  const chat         = useGhostChat(roomId, role);
  const [draft,      setDraft]      = useState("");
  const [copied,     setCopied]     = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);
  const copyTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages]);

  // Cleanup copy timer on unmount
  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || chat.status !== "secure") return;
    setDraft("");
    await chat.send(text);
    textareaRef.current?.focus();
  }, [draft, chat]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleCopyRoomId = async () => {
    const ok = await copyToClipboard(roomId);
    if (!ok) return;
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    setCopied(true);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2_000);
  };

  const handleAdminEnd = useCallback(async () => {
    if (!adminInfo?.token) return;
    try {
      await fetch("/admin/end-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminInfo.token}`,
        },
        body: JSON.stringify({ roomId }),
      });
    } catch { /* best-effort */ }
    chat.end();
    onBack();
  }, [adminInfo, roomId, chat, onBack]);

  const isActive = chat.status === "secure";
  const isClosed = chat.status === "closed" || chat.status === "error";
  const statusColor = STATUS_COLORS[chat.status] ?? "#666";
  const secureColor = secure ? ACCENT : ORANGE;

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: ${BG}; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #222; border-radius: 2px; }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.3;transform:scale(.7)} }
        @keyframes ringGlow { 0%,100%{box-shadow:0 0 0 0 ${ORANGE}44} 50%{box-shadow:0 0 0 8px ${ORANGE}00} }
        textarea:focus { border-color: ${ACCENT}66 !important; outline: none; }
        button:hover { opacity: 0.85; }
      `}</style>

      <div style={{ background: BG, color: "#e0e0e0", fontFamily: FONT, minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: "100%", maxWidth: "760px", display: "flex", flexDirection: "column", height: "100vh" }}>

          {/* ── Header ────────────────────────────────────────────────── */}
          <div style={{ borderBottom: "1px solid #1e1e1e", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", background: BG2, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <button onClick={() => { chat.end(); onBack(); }} style={{ background: "transparent", border: "none", color: "#444", cursor: "pointer", fontFamily: FONT, fontSize: "14px", padding: 0 }} title="Retour">←</button>
              <div>
                <div style={{ color: ACCENT, fontSize: "13px", fontWeight: "bold", letterSpacing: "0.15em" }}>
                  ⬡ GhostMesh
                  {role === "admin" && <span style={{ color: "#444", fontSize: "10px", marginLeft: "8px" }}>ADMIN</span>}
                </div>
                <button
                  onClick={handleCopyRoomId}
                  title="Copier l'ID de room"
                  style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: copied ? ACCENT : "#333", fontSize: "9px", fontFamily: FONT, letterSpacing: "0.05em" }}
                >
                  {role === "admin"
                    ? `${adminInfo?.label ?? "Client"} · ${adminInfo?.code}`
                    : `room ${roomId.slice(0, 8)}...`} {copied ? "✓ copié" : "⊕"}
                </button>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={badgeStyle(secureColor)}>{secure ? "✓ SÉCURISÉ" : "⚠ INSECURE"}</div>
              <div style={badgeStyle(statusColor)}>{STATUS_LABELS[chat.status] ?? chat.status}</div>
            </div>
          </div>

          {/* ── Insecure warning ──────────────────────────────────────── */}
          {!secure && (
            <div style={{ background: `${ORANGE}0a`, borderBottom: `1px solid ${ORANGE}33`, padding: "8px 20px", fontSize: "10px", color: ORANGE, letterSpacing: "0.08em", flexShrink: 0, display: "flex", gap: "8px" }}>
              <span>⚠</span>
              <span>SESSION NON SÉCURISÉE — Code général utilisé. L'identité du client n'est pas vérifiée.</span>
            </div>
          )}

          {/* ── Verification code ─────────────────────────────────────── */}
          {chat.verification && (
            <div style={{ padding: "10px 20px 0", flexShrink: 0 }}>
              <div style={{ padding: "10px 14px", border: `1px solid ${ACCENT}44`, borderRadius: "4px", background: `${ACCENT}08`, fontSize: "12px", color: "#aaa", display: "flex", alignItems: "center", gap: "14px" }}>
                <div>
                  <div style={{ color: ACCENT, fontSize: "10px", letterSpacing: "0.1em" }}>CODE DE VÉRIFICATION</div>
                  <div style={{ marginTop: "4px", display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "18px", letterSpacing: "4px" }}>{chat.verification.emojis}</span>
                    <span style={{ fontSize: "13px", color: ACCENT, letterSpacing: "0.15em" }}>{chat.verification.hex}</span>
                  </div>
                </div>
                <div style={{ fontSize: "10px", color: "#444", maxWidth: "200px", lineHeight: "1.5" }}>
                  Comparez ce code avec votre interlocuteur.
                </div>
              </div>
            </div>
          )}

          {/* ── Error ─────────────────────────────────────────────────── */}
          {chat.error && (
            <div style={{ padding: "10px 20px 0", flexShrink: 0 }}>
              <div style={errorBoxStyle()}>⚠ {chat.error}</div>
            </div>
          )}

          {/* ── Ring sent toast (client) ───────────────────────────────── */}
          {chat.ringAcked && role === "client" && (
            <div style={{ padding: "10px 20px 0", flexShrink: 0 }}>
              <div style={{ ...errorBoxStyle(ORANGE), textAlign: "center" }}>🔔 Appel envoyé au vendeur</div>
            </div>
          )}

          {/* ── Messages / Waiting ────────────────────────────────────── */}
          {!isActive && !isClosed && chat.messages.length === 0 ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px", color: "#444", fontSize: "12px", letterSpacing: "0.1em" }}>
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: ACCENT, animation: "pulse 1.4s ease-in-out infinite" }} />
              <div>{STATUS_LABELS[chat.status] ?? "..."}</div>
              {(chat.status === "signaling" || chat.status === "connecting") && (
                <div style={{ color: "#333", fontSize: "10px" }}>
                  {role === "client" ? "En attente du vendeur..." : "En attente du client..."}
                </div>
              )}
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: "10px" }}>
              {chat.messages.map((m) => (
                <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: m.self ? "flex-end" : "flex-start" }}>
                  <div style={{ maxWidth: "78%", background: m.self ? `${ACCENT}18` : BG3, border: `1px solid ${m.self ? ACCENT + "44" : "#222"}`, borderRadius: m.self ? "12px 12px 2px 12px" : "12px 12px 12px 2px", padding: "9px 13px" }}>
                    <div style={{ fontSize: "9px", color: m.self ? `${ACCENT}99` : "#555", marginBottom: "4px", textAlign: m.self ? "right" : "left", letterSpacing: "0.05em" }}>
                      {m.self
                        ? (role === "admin" ? "ADMIN" : "VOUS")
                        : (role === "admin" ? (adminInfo?.label ?? "CLIENT") : "VENDEUR")
                      } · {formatTime(m.ts)}
                    </div>
                    <div style={{ fontSize: "13px", color: "#e0e0e0", lineHeight: "1.5", wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{m.text}</div>
                  </div>
                </div>
              ))}
              {isClosed && (
                <div style={{ textAlign: "center", color: "#444", fontSize: "11px", marginTop: "20px", letterSpacing: "0.1em" }}>
                  — SESSION TERMINÉE —
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* ── Back button (session closed) ───────────────────────────── */}
          {isClosed && (
            <div style={{ padding: "0 20px 16px", display: "flex", justifyContent: "center", flexShrink: 0 }}>
              <button onClick={onBack} style={{ background: "transparent", color: "#555", border: "1px solid #2a2a2a", borderRadius: "4px", padding: "10px 24px", fontFamily: FONT, fontSize: "11px", cursor: "pointer", letterSpacing: "0.1em" }}>
                ← RETOUR AU MENU
              </button>
            </div>
          )}

          {/* ── Input row ─────────────────────────────────────────────── */}
          {!isClosed && (
            <div style={{ borderTop: "1px solid #1e1e1e", padding: "12px 20px", display: "flex", gap: "8px", background: BG2, flexShrink: 0, alignItems: "flex-end" }}>
              <textarea
                ref={textareaRef}
                style={{ flex: 1, background: BG3, border: "1px solid #2a2a2a", color: "#e0e0e0", fontFamily: FONT, fontSize: "13px", padding: "10px 14px", borderRadius: "4px", outline: "none", resize: "none" }}
                rows={2}
                placeholder={isActive ? "Message chiffré E2E... (Entrée pour envoyer)" : "En attente de connexion sécurisée..."}
                value={draft}
                disabled={!isActive}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <button
                  disabled={!isActive || !draft.trim()}
                  onClick={handleSend}
                  style={{ background: ACCENT, color: BG, border: "none", borderRadius: "4px", padding: "0 16px", height: "36px", fontFamily: FONT, fontSize: "11px", fontWeight: "bold", cursor: !isActive || !draft.trim() ? "not-allowed" : "pointer", letterSpacing: "0.08em", opacity: !isActive || !draft.trim() ? 0.4 : 1 }}
                >
                  ENVOYER
                </button>
                <div style={{ display: "flex", gap: "6px" }}>
                  {role === "client" && (
                    <button
                      onClick={chat.ring}
                      disabled={chat.ringAcked}
                      title="Appeler le vendeur"
                      style={{ background: chat.ringAcked ? `${ORANGE}22` : "transparent", color: chat.ringAcked ? ORANGE : "#555", border: `1px solid ${chat.ringAcked ? ORANGE + "66" : "#2a2a2a"}`, borderRadius: "4px", padding: "0 10px", height: "28px", fontFamily: FONT, fontSize: "13px", cursor: chat.ringAcked ? "not-allowed" : "pointer", flex: 1, animation: chat.ringAcked ? "ringGlow .8s infinite" : "none" }}
                    >🔔</button>
                  )}
                  {role === "admin" && (
                    <button
                      onClick={handleAdminEnd}
                      style={{ background: "transparent", color: RED, border: `1px solid ${RED}55`, borderRadius: "4px", padding: "0 10px", height: "28px", fontFamily: FONT, fontSize: "10px", cursor: "pointer", letterSpacing: "0.08em", flex: 1 }}
                    >FIN</button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
