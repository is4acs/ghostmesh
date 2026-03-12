import { useState, useMemo, useCallback } from "react";
import { useAdminSocket, type AdminSession, type AdminNotif } from "../hooks/useAdminSocket";
import {
  ACCENT, BG, BG2, BG3, RED, ORANGE, FONT,
  formatTime, formatCountdown, copyToClipboard, errorBoxStyle, badgeStyle, TTL_MS,
} from "../theme";

// ─── Static maps (module-level — allocated once) ───────────────────────────────

const NOTIF_ICONS: Record<AdminNotif["type"], string> = {
  client_waiting: "◈",
  client_ring:    "🔔",
  session_ended:  "✕",
  peer_left:      "◉",
};

const NOTIF_COLORS: Record<AdminNotif["type"], string> = {
  client_waiting: ACCENT,
  client_ring:    ORANGE,
  session_ended:  RED,
  peer_left:      "#555",
};

const NOTIF_LABELS: Record<AdminNotif["type"], string> = {
  client_waiting: "NOUVEAU CONTACT",
  client_ring:    "APPEL ENTRANT",
  session_ended:  "SESSION FERMÉE",
  peer_left:      "PAIR DÉCONNECTÉ",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function NotifBadge({ notif }: { notif: AdminNotif }) {
  const color = NOTIF_COLORS[notif.type];
  return (
    <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", padding: "8px 12px", borderBottom: "1px solid #111", fontSize: "11px" }}>
      <span style={{ color, fontSize: "14px", flexShrink: 0 }}>{NOTIF_ICONS[notif.type]}</span>
      <div style={{ flex: 1 }}>
        <div style={{ color, letterSpacing: "0.1em", fontSize: "9px" }}>{NOTIF_LABELS[notif.type]}</div>
        <div style={{ color: "#666", marginTop: "2px" }}>
          {"code" in notif && notif.code
            ? <span>code <span style={{ color: "#aaa" }}>{notif.code}</span>{"label" in notif && notif.label && <span style={{ color: "#555" }}> · {notif.label}</span>}</span>
            : <span>room {notif.roomId.slice(0, 8)}</span>
          }
        </div>
      </div>
      <div style={{ color: "#333", fontSize: "9px", flexShrink: 0 }}>{formatTime(notif.ts)}</div>
    </div>
  );
}

function SessionCard({
  session,
  onJoin,
  onEnd,
}: {
  session: AdminSession;
  onJoin: () => void;
  onEnd:  () => void;
}) {
  const now       = Date.now();
  const remaining = TTL_MS - (now - session.createdAt);
  const urgent    = remaining < 2 * 60 * 1_000; // < 2 min left
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(session.clientCode);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2_000); }
  }, [session.clientCode]);

  return (
    <div style={{ background: BG2, border: `1px solid ${session.secure ? "#1e1e1e" : ORANGE + "44"}`, borderRadius: "8px", padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px", flexWrap: "wrap" }}>
          <span style={{ ...badgeStyle(session.secure ? ACCENT : ORANGE), fontWeight: "bold", fontSize: "9px" }}>
            {session.secure ? "✓ SÉCURISÉ" : "⚠ INSECURE"}
          </span>
          <span style={{ color: "#555", fontSize: "9px" }}>{session.peers} pair{session.peers !== 1 ? "s" : ""}</span>
          <span style={{ color: urgent ? RED : "#444", fontSize: "9px", marginLeft: "auto" }}>
            ⏱ {formatCountdown(remaining)}
          </span>
        </div>
        <div style={{ color: "#aaa", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {session.clientLabel || "Client inconnu"}
        </div>
        <button
          onClick={handleCopy}
          style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: copied ? ACCENT : "#333", fontSize: "9px", fontFamily: FONT, letterSpacing: "0.1em" }}
          title="Copier le code"
        >
          {session.clientCode} {copied ? "✓" : "⊕"}
        </button>
      </div>
      <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
        <button onClick={onJoin} style={{ background: ACCENT, color: BG, border: "none", borderRadius: "4px", padding: "8px 14px", fontFamily: FONT, fontSize: "10px", fontWeight: "bold", cursor: "pointer", letterSpacing: "0.08em" }}>
          REJOINDRE
        </button>
        <button onClick={onEnd} style={{ background: "transparent", color: RED, border: `1px solid ${RED}55`, borderRadius: "4px", padding: "8px 12px", fontFamily: FONT, fontSize: "10px", cursor: "pointer", letterSpacing: "0.08em" }}>
          FIN
        </button>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

interface Props {
  token:         string;
  onJoinSession: (session: AdminSession) => void;
}

export function AdminDashboard({ token, onJoinSession }: Props) {
  const adm = useAdminSocket(token);
  const [tab,        setTab]        = useState<"sessions" | "codes" | "notifs">("sessions");
  const [newCode,    setNewCode]    = useState("");
  const [newLabel,   setNewLabel]   = useState("");
  const [codeError,  setCodeError]  = useState<string | null>(null);
  const [codeLoading,setCodeLoading]= useState(false);

  // Memoised unread counts — avoid recomputing on every render
  const { unreadRings, unreadNew } = useMemo(() => ({
    unreadRings: adm.notifs.filter((n) => n.type === "client_ring").length,
    unreadNew:   adm.notifs.filter((n) => n.type === "client_waiting").length,
  }), [adm.notifs]);

  const handleCreateCode = useCallback(async () => {
    const code = newCode.trim();
    if (!/^\d{8}$/.test(code)) { setCodeError("Format JJMMAAAA requis (8 chiffres)"); return; }
    setCodeLoading(true);
    setCodeError(null);
    try {
      await adm.createCode(code, newLabel.trim() || "Contact");
      setNewCode("");
      setNewLabel("");
    } catch (e) {
      setCodeError(String(e));
    } finally {
      setCodeLoading(false);
    }
  }, [adm, newCode, newLabel]);

  const tabStyle = useCallback((active: boolean): React.CSSProperties => ({
    background: "transparent",
    border: "none",
    borderBottom: active ? `2px solid ${ACCENT}` : "2px solid transparent",
    color: active ? ACCENT : "#444",
    fontFamily: FONT,
    fontSize: "10px",
    letterSpacing: "0.12em",
    padding: "8px 14px",
    cursor: "pointer",
    flexShrink: 0,
  }), []);

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: ${BG}; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #222; border-radius: 2px; }
        button:hover { opacity: 0.85; }
        .adm-input {
          background: ${BG3};
          border: 1px solid #2a2a2a;
          color: #e0e0e0;
          font-family: ${FONT};
          font-size: 12px;
          padding: 9px 12px;
          border-radius: 4px;
          outline: none;
          transition: border-color 0.15s;
        }
        .adm-input:focus { border-color: ${ACCENT}55; }
      `}</style>
      <div style={{ background: BG, color: "#e0e0e0", fontFamily: FONT, minHeight: "100vh", display: "flex", flexDirection: "column", maxWidth: "700px", margin: "0 auto" }}>

        {/* Header */}
        <div style={{ background: BG2, borderBottom: "1px solid #1a1a1a", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ color: ACCENT, fontSize: "13px", fontWeight: "bold", letterSpacing: "0.15em" }}>⬡ GHOSTMESH — ADMIN</div>
            <div style={{ color: "#333", fontSize: "9px", letterSpacing: "0.1em", marginTop: "2px" }}>PANNEAU ADMIN</div>
          </div>
          <div style={badgeStyle(adm.connected ? ACCENT : "#444")}>
            {adm.connected ? "● CONNECTÉ" : "○ RECONNEXION..."}
          </div>
        </div>

        {/* Insecure code info */}
        <div style={{ margin: "12px 20px 0", padding: "10px 14px", background: `${ORANGE}0a`, border: `1px solid ${ORANGE}33`, borderRadius: "6px", fontSize: "11px", color: "#888", display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ color: ORANGE }}>⚠</span>
          <span>Code insecure général : <span style={{ color: ORANGE, letterSpacing: "0.15em" }}>{adm.insecureCode}</span><span style={{ color: "#444" }}> — sessions marquées NON SÉCURISÉ</span></span>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #1a1a1a", margin: "12px 0 0", flexShrink: 0 }}>
          <button style={tabStyle(tab === "sessions")} onClick={() => setTab("sessions")}>
            SESSIONS ({adm.sessions.length})
          </button>
          <button style={tabStyle(tab === "codes")} onClick={() => setTab("codes")}>
            CODES ({adm.codes.length})
          </button>
          <button style={tabStyle(tab === "notifs")} onClick={() => setTab("notifs")}>
            ALERTES
            {(unreadRings + unreadNew) > 0 && (
              <span style={{ marginLeft: "6px", background: unreadRings > 0 ? ORANGE : ACCENT, color: BG, borderRadius: "10px", padding: "1px 6px", fontSize: "9px", fontWeight: "bold" }}>
                {unreadRings + unreadNew}
              </span>
            )}
          </button>
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: "auto" }}>

          {/* SESSIONS */}
          {tab === "sessions" && (
            <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: "10px" }}>
              {adm.sessions.length === 0
                ? <div style={{ color: "#2a2a2a", fontSize: "12px", textAlign: "center", marginTop: "40px", letterSpacing: "0.1em" }}>Aucune session active</div>
                : adm.sessions.map((s) => (
                    <SessionCard
                      key={s.roomId}
                      session={s}
                      onJoin={() => onJoinSession(s)}
                      onEnd={() => adm.endSession(s.roomId)}
                    />
                  ))
              }
            </div>
          )}

          {/* CODES */}
          {tab === "codes" && (
            <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ background: BG2, border: `1px solid ${ACCENT}22`, borderRadius: "8px", padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ color: "#666", fontSize: "10px", letterSpacing: "0.12em" }}>CRÉER UN CODE D'ACCÈS</div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input className="adm-input" type="text" inputMode="numeric" placeholder="JJMMAAAA" maxLength={8}
                    value={newCode}
                    onChange={(e) => { setNewCode(e.target.value.replace(/\D/g, "").slice(0, 8)); setCodeError(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleCreateCode(); }}
                    style={{ flex: "0 0 140px", letterSpacing: "0.15em", textAlign: "center" }}
                  />
                  <input className="adm-input" type="text" placeholder="Nom du contact" value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleCreateCode(); }}
                    style={{ flex: 1 }}
                  />
                  <button onClick={handleCreateCode} disabled={codeLoading}
                    style={{ background: ACCENT, color: BG, border: "none", borderRadius: "4px", padding: "0 16px", fontFamily: FONT, fontSize: "10px", fontWeight: "bold", cursor: codeLoading ? "not-allowed" : "pointer", letterSpacing: "0.08em", flexShrink: 0, opacity: codeLoading ? 0.6 : 1 }}
                  >
                    + CRÉER
                  </button>
                </div>
                {codeError && <div style={errorBoxStyle()}>⚠ {codeError}</div>}
                <div style={{ color: "#2a2a2a", fontSize: "10px" }}>Format : date de naissance (ex: 15091985 = 15 sep 1985)</div>
              </div>

              {adm.codes.length === 0
                ? <div style={{ color: "#2a2a2a", fontSize: "12px", textAlign: "center", marginTop: "20px" }}>Aucun code créé</div>
                : adm.codes.map((c) => (
                    <div key={c.code} style={{ background: BG2, border: "1px solid #1a1a1a", borderRadius: "6px", padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <span style={{ color: ACCENT, fontSize: "14px", letterSpacing: "0.2em" }}>{c.code}</span>
                        <span style={{ color: "#666", fontSize: "11px", marginLeft: "12px" }}>{c.label}</span>
                      </div>
                      <button onClick={() => adm.deleteCode(c.code)}
                        style={{ background: "transparent", color: "#444", border: "1px solid #222", borderRadius: "4px", padding: "5px 10px", fontFamily: FONT, fontSize: "9px", cursor: "pointer" }}
                      >SUPPR</button>
                    </div>
                  ))
              }
            </div>
          )}

          {/* ALERTES */}
          {tab === "notifs" && (
            <div>
              {adm.notifs.length > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 16px 0" }}>
                  <button
                    onClick={adm.clearNotifs}
                    style={{ background: "transparent", border: "1px solid #222", color: "#444", borderRadius: "4px", padding: "4px 10px", fontFamily: FONT, fontSize: "9px", cursor: "pointer", letterSpacing: "0.1em" }}
                  >
                    🗑 EFFACER
                  </button>
                </div>
              )}
              {adm.notifs.length === 0
                ? <div style={{ color: "#2a2a2a", fontSize: "12px", textAlign: "center", marginTop: "40px" }}>Aucune alerte</div>
                : adm.notifs.map((n, i) => <NotifBadge key={i} notif={n} />)
              }
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Required for React.CSSProperties in tabStyle
import type React from "react";
