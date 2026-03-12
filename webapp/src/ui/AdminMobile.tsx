import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type React from "react";
import { useAdminSocket, type AdminSession, type AdminNotif } from "../hooks/useAdminSocket";
import { useGhostChat } from "../hooks/useGhostChat";
import {
  ACCENT, BG, BG2, BG3, RED, ORANGE, FONT,
  formatTime, formatCountdown, copyToClipboard, TTL_MS,
  SAFE_AREA_TOP, SAFE_AREA_BOTTOM, API_BASE,
} from "../theme";

// ─── Global Styles ────────────────────────────────────────────────────────────
const GLOBAL_CSS = `
  @keyframes gm-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.2;transform:scale(.5)} }
  @keyframes gm-glow { 0%,100%{filter:drop-shadow(0 0 6px rgba(200,255,0,.3))} 50%{filter:drop-shadow(0 0 22px rgba(200,255,0,.8))} }
  @keyframes gm-shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-7px)} 40%,80%{transform:translateX(7px)} }
  @keyframes gm-fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  @keyframes gm-slideUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
  @keyframes gm-spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  @keyframes gm-ring { 0%{transform:rotate(0)} 15%{transform:rotate(14deg)} 30%{transform:rotate(-11deg)} 45%{transform:rotate(9deg)} 60%{transform:rotate(-7deg)} 75%{transform:rotate(4deg)} 90%{transform:rotate(-2deg)} 100%{transform:rotate(0)} }
  @keyframes gm-blink { 0%,100%{opacity:1} 50%{opacity:.3} }
  .gm-input { transition: border-color .15s, background .15s !important; }
  .gm-input:focus { border-color: ${ACCENT}55 !important; outline: none !important; background: #111 !important; }
  .gm-btn:active { transform: scale(.96) !important; opacity: .85 !important; }
  .gm-tab:active { opacity: .7 !important; }
  .gm-card { animation: gm-fadeIn .22s ease both; }
  .gm-notif { animation: gm-slideUp .2s ease both; }
  * { -webkit-tap-highlight-color: transparent !important; box-sizing: border-box !important; }
  textarea { resize: none !important; }
  input[type=password]::-webkit-credentials-auto-fill-button { visibility: hidden; }
`;

// ─── Shared hook: live clock (tick every second) ───────────────────────────
function useTick() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ─── Style helpers ─────────────────────────────────────────────────────────
const S = {
  input: (extra?: React.CSSProperties): React.CSSProperties => ({
    background: "#0e0e0e",
    border: "1px solid #222",
    color: "#e8e8e8",
    fontFamily: FONT,
    fontSize: "16px",
    padding: "15px 16px",
    borderRadius: "14px",
    width: "100%",
    WebkitAppearance: "none",
    ...extra,
  }),
  btnPrimary: (disabled = false): React.CSSProperties => ({
    background: disabled ? "#1a1a1a" : ACCENT,
    color: disabled ? "#333" : BG,
    border: "none",
    borderRadius: "14px",
    padding: "16px 24px",
    fontFamily: FONT,
    fontSize: "14px",
    fontWeight: "bold",
    letterSpacing: "0.08em",
    cursor: disabled ? "default" : "pointer",
    transition: "transform .08s, opacity .1s",
    width: "100%",
  }),
  btnGhost: (color = "#666"): React.CSSProperties => ({
    background: "transparent",
    color,
    border: `1px solid ${color}44`,
    borderRadius: "12px",
    padding: "12px 18px",
    fontFamily: FONT,
    fontSize: "12px",
    letterSpacing: "0.08em",
    cursor: "pointer",
  }),
  card: (extra?: React.CSSProperties): React.CSSProperties => ({
    background: BG2,
    border: "1px solid #1c1c1c",
    borderRadius: "18px",
    padding: "18px 16px",
    ...extra,
  }),
  badge: (color: string): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    padding: "4px 10px",
    borderRadius: "20px",
    background: `${color}12`,
    border: `1px solid ${color}30`,
    color,
    fontSize: "10px",
    letterSpacing: "0.1em",
    fontWeight: "bold",
  }),
};

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN LOGIN — GrapheneOS Edition
// ═══════════════════════════════════════════════════════════════════════════

interface LoginProps { onLogin: (token: string) => void; }

export function AdminLoginMobile({ onLogin }: LoginProps) {
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 400);
    return () => clearTimeout(t);
  }, []);

  const triggerError = (msg: string) => {
    setError(msg);
    setShake(true);
    setTimeout(() => setShake(false), 600);
  };

  const handleSubmit = async () => {
    const t = token.trim();
    if (!t) { triggerError("Token requis"); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: t }),
      });
      if (res.status === 401) { setLoading(false); triggerError("Token invalide"); return; }
      if (!res.ok) { setLoading(false); triggerError(`Erreur serveur (${res.status})`); return; }
      sessionStorage.setItem("ghost_admin_token", t);
      onLogin(t);
    } catch {
      setLoading(false);
      triggerError("Serveur inaccessible");
    }
  };

  return (
    <div style={{
      background: BG,
      minHeight: "100dvh",
      fontFamily: FONT,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: `calc(${SAFE_AREA_TOP} + 40px) 28px calc(${SAFE_AREA_BOTTOM} + 40px)`,
      backgroundImage: [
        `radial-gradient(ellipse 65% 40% at 50% 0%, rgba(200,255,0,.07) 0%, transparent 70%)`,
        `linear-gradient(rgba(200,255,0,.015) 1px, transparent 1px)`,
        `linear-gradient(90deg, rgba(200,255,0,.015) 1px, transparent 1px)`,
      ].join(","),
      backgroundSize: "100% 100%, 52px 52px, 52px 52px",
    }}>
      <style>{GLOBAL_CSS}</style>

      {/* ── Logo ── */}
      <div style={{ textAlign: "center", marginBottom: "44px" }}>
        <div style={{
          fontSize: "64px",
          color: ACCENT,
          lineHeight: 1,
          animation: "gm-glow 3s ease-in-out infinite",
          marginBottom: "18px",
        }}>⬡</div>
        <div style={{
          color: "#d8d8d8",
          fontSize: "20px",
          letterSpacing: "0.32em",
          fontWeight: "bold",
          marginBottom: "10px",
        }}>GHOSTMESH</div>
        <div style={{
          display: "inline-block",
          padding: "5px 16px",
          borderRadius: "20px",
          border: `1px solid ${ACCENT}2a`,
          background: `${ACCENT}08`,
          color: ACCENT,
          fontSize: "10px",
          letterSpacing: "0.24em",
        }}>PANNEAU ADMINISTRATEUR</div>
      </div>

      {/* ── Card ── */}
      <div style={{
        width: "100%",
        maxWidth: "360px",
        background: "rgba(12,12,12,.95)",
        border: "1px solid #1e1e1e",
        borderRadius: "22px",
        padding: "28px 24px",
        backdropFilter: "blur(12px)",
        animation: shake ? "gm-shake .5s ease" : undefined,
      }}>
        <div style={{ color: "#3a3a3a", fontSize: "10px", letterSpacing: "0.2em", marginBottom: "10px" }}>
          TOKEN D'ACCÈS
        </div>

        {/* Input row */}
        <div style={{ position: "relative", marginBottom: "18px" }}>
          <input
            ref={inputRef}
            className="gm-input"
            type={show ? "text" : "password"}
            placeholder="••••••••••••"
            value={token}
            onChange={e => { setToken(e.target.value); setError(null); }}
            onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            style={{
              ...S.input({ paddingRight: "56px", fontSize: "20px", letterSpacing: show ? "0.1em" : "0.35em", background: "#0a0a0a", border: "1px solid #1e1e1e" }),
            }}
          />
          <button
            onClick={() => setShow(s => !s)}
            style={{
              position: "absolute", right: "16px", top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", padding: "6px",
              color: show ? ACCENT : "#3a3a3a", fontSize: "18px", cursor: "pointer", lineHeight: 1,
            }}
          >{show ? "◉" : "◎"}</button>
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={loading || !token.trim()}
          className="gm-btn"
          style={{
            ...S.btnPrimary(loading || !token.trim()),
            height: "56px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            borderRadius: "16px",
            fontSize: "15px",
          }}
        >
          {loading ? (
            <>
              <span style={{
                width: "17px", height: "17px",
                border: `2px solid ${BG}30`, borderTopColor: BG,
                borderRadius: "50%",
                animation: "gm-spin .65s linear infinite",
                display: "inline-block", flexShrink: 0,
              }} />
              CONNEXION...
            </>
          ) : "ACCÉDER →"}
        </button>

        {/* Error */}
        {error && (
          <div style={{
            marginTop: "14px",
            padding: "13px 16px",
            background: `${RED}0c`,
            border: `1px solid ${RED}28`,
            borderRadius: "12px",
            color: RED,
            fontSize: "13px",
            textAlign: "center",
            letterSpacing: "0.04em",
          }}>⚠ {error}</div>
        )}
      </div>

      {/* Version footer */}
      <div style={{ marginTop: "36px", color: "#1e1e1e", fontSize: "10px", letterSpacing: "0.14em" }}>
        GHOSTMESH ADMIN · GRAPHENEOS EDITION
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN DASHBOARD — Bottom Nav, Live Timers
// ═══════════════════════════════════════════════════════════════════════════

interface DashboardProps {
  token: string;
  onJoinSession: (session: AdminSession) => void;
}

type Tab = "sessions" | "codes" | "alerts";

export function AdminDashboardMobile({ token, onJoinSession }: DashboardProps) {
  const adm = useAdminSocket(token);
  const [tab, setTab] = useState<Tab>("sessions");
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);

  const urgentRings = useMemo(() => adm.notifs.filter(n => n.type === "client_ring").length, [adm.notifs]);
  const newClients = useMemo(() => adm.notifs.filter(n => n.type === "client_waiting").length, [adm.notifs]);
  const totalAlerts = urgentRings + newClients;

  // ── Push notifications ────────────────────────────────────────────────────
  const prevNotifsLen = useRef(0);
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);
  useEffect(() => {
    const prev = prevNotifsLen.current;
    prevNotifsLen.current = adm.notifs.length;
    if (adm.notifs.length <= prev) return;
    const newest = adm.notifs[0];
    if (!newest || !("Notification" in window) || Notification.permission !== "granted") return;
    if (newest.type === "client_waiting") {
      new Notification("GhostMesh — Nouveau client", {
        body: `${newest.label ?? newest.code} initie une session`,
        icon: "/icons/icon.svg",
        tag: newest.roomId,
        silent: false,
      });
    } else if (newest.type === "client_ring") {
      new Notification("GhostMesh — Appel entrant", {
        body: `${newest.label ?? newest.code} sonne`,
        icon: "/icons/icon.svg",
        tag: newest.roomId + "-ring",
        silent: false,
      });
    }
  }, [adm.notifs]);

  const handleCreateCode = useCallback(async () => {
    const code = newCode.trim();
    if (!/^\d{8}$/.test(code)) { setCodeError("Format : JJMMAAAA (8 chiffres)"); return; }
    setCodeLoading(true);
    setCodeError(null);
    try {
      await adm.createCode(code, newLabel.trim() || "Client");
      setNewCode("");
      setNewLabel("");
    } catch (e) {
      setCodeError(String(e));
    } finally {
      setCodeLoading(false);
    }
  }, [adm, newCode, newLabel]);

  const NAV: { id: Tab; icon: string; label: string }[] = [
    { id: "sessions", icon: "◈", label: "SESSIONS" },
    { id: "codes",    icon: "⚿", label: "CODES" },
    { id: "alerts",   icon: "◉", label: "ALERTES" },
  ];

  return (
    <div style={{
      background: BG,
      fontFamily: FONT,
      height: "100dvh",
      display: "flex",
      flexDirection: "column",
      paddingTop: SAFE_AREA_TOP,
    }}>
      <style>{GLOBAL_CSS}</style>

      {/* ── Header ── */}
      <div style={{
        padding: "14px 20px 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "1px solid #141414",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ color: ACCENT, fontSize: "22px", animation: "gm-glow 4s ease-in-out infinite" }}>⬡</span>
          <div>
            <div style={{ color: "#ccc", fontSize: "15px", letterSpacing: "0.18em", fontWeight: "bold" }}>GHOSTMESH</div>
            <div style={{ color: "#2e2e2e", fontSize: "9px", letterSpacing: "0.18em" }}>ADMIN PANEL</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Insecure code pill */}
          {adm.insecureCode && (
            <div style={{
              padding: "4px 10px",
              borderRadius: "20px",
              background: `${ORANGE}0e`,
              border: `1px solid ${ORANGE}28`,
              color: ORANGE,
              fontSize: "9px",
              letterSpacing: "0.1em",
            }}>
              ⚠ {adm.insecureCode}
            </div>
          )}
          {/* Connection status */}
          <div style={{
            padding: "6px 12px",
            borderRadius: "20px",
            background: adm.connected ? `${ACCENT}10` : "#111",
            border: `1px solid ${adm.connected ? ACCENT + "28" : "#1c1c1c"}`,
            color: adm.connected ? ACCENT : "#333",
            fontSize: "9px",
            letterSpacing: "0.12em",
            display: "flex",
            alignItems: "center",
            gap: "5px",
          }}>
            <span style={{
              width: "6px", height: "6px", borderRadius: "50%",
              background: adm.connected ? ACCENT : "#333",
              animation: adm.connected ? undefined : "gm-blink 1.5s ease infinite",
              flexShrink: 0,
            }} />
            {adm.connected ? "EN LIGNE" : "RECO."}
          </div>
        </div>
      </div>

      {/* ── Urgent ring banner ── */}
      {urgentRings > 0 && (
        <div style={{
          margin: "10px 16px 0",
          padding: "12px 16px",
          background: `${ORANGE}10`,
          border: `1px solid ${ORANGE}30`,
          borderRadius: "14px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          cursor: "pointer",
          flexShrink: 0,
        }} onClick={() => setTab("alerts")}>
          <span style={{ fontSize: "18px", animation: "gm-ring 1.2s ease infinite" }}>🔔</span>
          <div>
            <div style={{ color: ORANGE, fontSize: "12px", letterSpacing: "0.08em", fontWeight: "bold" }}>
              {urgentRings} APPEL{urgentRings > 1 ? "S" : ""} EN ATTENTE
            </div>
            <div style={{ color: "#664400", fontSize: "10px", marginTop: "1px" }}>Touchez pour voir les alertes</div>
          </div>
          <span style={{ marginLeft: "auto", color: ORANGE, fontSize: "18px" }}>›</span>
        </div>
      )}

      {/* ── Tab Content ── */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>

        {/* SESSIONS TAB */}
        {tab === "sessions" && (
          <div style={{ padding: "14px 16px 16px" }}>
            {/* Count header */}
            <div style={{
              color: "#2a2a2a",
              fontSize: "10px",
              letterSpacing: "0.16em",
              marginBottom: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
              <span>{adm.sessions.length} SESSION{adm.sessions.length !== 1 ? "S" : ""} ACTIVE{adm.sessions.length !== 1 ? "S" : ""}</span>
              {adm.sessions.length > 0 && (
                <span style={{ color: "#1e1e1e" }}>↑ REJOINDRE POUR CHATTER</span>
              )}
            </div>

            {adm.sessions.length === 0 ? (
              <EmptyState icon="◈" label="Aucune session active" sub="Les clients apparaîtront ici" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {adm.sessions.map(s => (
                  <SessionCard
                    key={s.roomId}
                    session={s}
                    onJoin={() => onJoinSession(s)}
                    onEnd={() => adm.endSession(s.roomId)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* CODES TAB */}
        {tab === "codes" && (
          <div style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
            {/* Create code form */}
            <div style={{ ...S.card({ border: `1px solid ${ACCENT}18`, background: "#080808" }) }}>
              <div style={{ color: "#2e2e2e", fontSize: "10px", letterSpacing: "0.18em", marginBottom: "14px" }}>
                NOUVEAU CODE D'ACCÈS
              </div>
              <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
                <input
                  className="gm-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="JJMMAAAA"
                  maxLength={8}
                  value={newCode}
                  onChange={e => { setNewCode(e.target.value.replace(/\D/g, "").slice(0, 8)); setCodeError(null); }}
                  style={{
                    ...S.input({ flex: "0 0 128px", textAlign: "center", letterSpacing: "0.18em", fontSize: "17px" }),
                  }}
                />
                <input
                  className="gm-input"
                  type="text"
                  placeholder="Nom client"
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  style={S.input({ flex: "1" })}
                />
              </div>
              <button
                onClick={handleCreateCode}
                disabled={codeLoading || newCode.length !== 8}
                className="gm-btn"
                style={S.btnPrimary(codeLoading || newCode.length !== 8)}
              >
                {codeLoading ? "CRÉATION..." : "＋ CRÉER CODE"}
              </button>
              {codeError && (
                <div style={{ color: RED, fontSize: "12px", marginTop: "10px", textAlign: "center", letterSpacing: "0.05em" }}>
                  ⚠ {codeError}
                </div>
              )}
            </div>

            {/* Codes list */}
            {adm.codes.length === 0 ? (
              <EmptyState icon="⚿" label="Aucun code actif" sub="Créez un code pour vos clients" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {adm.codes.map(c => (
                  <CodeItem key={c.code} code={c.code} label={c.label} onDelete={() => adm.deleteCode(c.code)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ALERTS TAB */}
        {tab === "alerts" && (
          <div>
            {adm.notifs.length > 0 && (
              <div style={{ padding: "10px 16px 0", display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={adm.clearNotifs}
                  className="gm-btn"
                  style={S.btnGhost("#444")}
                >TOUT EFFACER</button>
              </div>
            )}
            {adm.notifs.length === 0 ? (
              <div style={{ paddingTop: "14px" }}>
                <EmptyState icon="◉" label="Aucune alerte" sub="Les notifications apparaîtront ici" />
              </div>
            ) : (
              <div>
                {adm.notifs.map((n, i) => (
                  <NotifItem key={i} notif={n} delay={i * 30} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom Nav ── */}
      <div style={{
        borderTop: "1px solid #141414",
        background: BG2,
        display: "flex",
        paddingBottom: SAFE_AREA_BOTTOM,
        flexShrink: 0,
      }}>
        {NAV.map(item => {
          const active = tab === item.id;
          const badge = item.id === "sessions" ? adm.sessions.length
            : item.id === "codes" ? adm.codes.length
            : totalAlerts;
          const urgent = item.id === "alerts" && urgentRings > 0;
          const color = active ? (urgent ? ORANGE : ACCENT) : "#2e2e2e";

          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className="gm-tab"
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                padding: "14px 8px 12px",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "4px",
                position: "relative",
              }}
            >
              {/* Active indicator */}
              {active && (
                <div style={{
                  position: "absolute",
                  top: 0,
                  left: "20%",
                  right: "20%",
                  height: "2px",
                  background: urgent ? ORANGE : ACCENT,
                  borderRadius: "0 0 3px 3px",
                }} />
              )}
              <span style={{ fontSize: "20px", color, lineHeight: 1 }}>{item.icon}</span>
              <span style={{ fontSize: "9px", color, letterSpacing: "0.12em", fontFamily: FONT }}>
                {item.label}
              </span>
              {badge > 0 && (
                <span style={{
                  position: "absolute",
                  top: "8px",
                  right: "calc(50% - 14px)",
                  background: urgent ? ORANGE : ACCENT,
                  color: BG,
                  borderRadius: "10px",
                  padding: "1px 6px",
                  fontSize: "9px",
                  fontWeight: "bold",
                  fontFamily: FONT,
                  minWidth: "17px",
                  textAlign: "center",
                }}>{badge > 99 ? "99+" : badge}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Session Card ─────────────────────────────────────────────────────────────
function SessionCard({ session, onJoin, onEnd }: {
  session: AdminSession;
  onJoin: () => void;
  onEnd: () => void;
}) {
  const now = useTick();
  const remaining = TTL_MS - (now - session.createdAt);
  const expired = remaining <= 0;
  const critical = remaining < 90_000 && !expired;
  const [copied, setCopied] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const handleCopy = async () => {
    const ok = await copyToClipboard(session.clientCode);
    if (!ok) return;
    if (copyTimer.current) clearTimeout(copyTimer.current);
    setCopied(true);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  const timerColor = expired ? RED : critical ? ORANGE : "#3a3a3a";

  return (
    <div className="gm-card" style={{
      ...S.card({
        border: session.secure ? "1px solid #1c1c1c" : `1px solid ${ORANGE}30`,
        background: session.secure ? BG2 : `linear-gradient(135deg, #0d0a00, ${BG2})`,
      }),
    }}>
      {/* Top row: badges + timer */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
        <span style={S.badge(session.secure ? ACCENT : ORANGE)}>
          {session.secure ? "⚡ SÉCURISÉ" : "⚠ INSECURE"}
        </span>
        <span style={S.badge("#444")}>
          {session.peers} pair{session.peers !== 1 ? "s" : ""}
        </span>
        <span style={{
          marginLeft: "auto",
          color: timerColor,
          fontSize: "12px",
          letterSpacing: "0.06em",
          fontFamily: FONT,
          animation: critical ? "gm-blink 1s ease infinite" : undefined,
        }}>
          ⏱ {expired ? "EXPIRÉ" : formatCountdown(remaining)}
        </span>
      </div>

      {/* Client name + code */}
      <div style={{ marginBottom: "12px" }}>
        <div style={{ color: "#bbb", fontSize: "16px", letterSpacing: "0.04em", marginBottom: "5px" }}>
          {session.clientLabel || "Client anonyme"}
        </div>
        <button
          onClick={handleCopy}
          style={{
            background: "none", border: "none", padding: 0,
            fontFamily: FONT, cursor: "pointer",
            display: "flex", alignItems: "center", gap: "6px",
          }}
        >
          <span style={{ color: "#333", fontSize: "12px", letterSpacing: "0.2em" }}>{session.clientCode}</span>
          <span style={{
            color: copied ? ACCENT : "#2a2a2a",
            fontSize: "13px",
            transition: "color .2s",
          }}>{copied ? "✓ copié" : "⊕"}</span>
        </button>
      </div>

      {/* Actions */}
      {confirmEnd ? (
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => { setConfirmEnd(false); onEnd(); }}
            className="gm-btn"
            style={{ ...S.btnGhost(RED), flex: 1, fontWeight: "bold" }}
          >CONFIRMER FIN</button>
          <button
            onClick={() => setConfirmEnd(false)}
            className="gm-btn"
            style={{ ...S.btnGhost("#444"), flex: 1 }}
          >ANNULER</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={onJoin}
            className="gm-btn"
            style={{ flex: 1, ...S.btnPrimary(false), padding: "14px", textAlign: "center" }}
          >REJOINDRE →</button>
          <button
            onClick={() => setConfirmEnd(true)}
            className="gm-btn"
            style={{ ...S.btnGhost(RED), padding: "14px 18px" }}
          >✕</button>
        </div>
      )}
    </div>
  );
}

// ─── Code Item ────────────────────────────────────────────────────────────────
function CodeItem({ code, label, onDelete }: { code: string; label: string; onDelete: () => void }) {
  const [copied, setCopied] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);

  const handleCopy = async () => {
    const ok = await copyToClipboard(code);
    if (!ok) return;
    if (t.current) clearTimeout(t.current);
    setCopied(true);
    t.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="gm-card" style={S.card({ display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px" })}>
      <button onClick={handleCopy} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", flex: 1, textAlign: "left" }}>
        <div style={{ color: copied ? ACCENT : "#999", fontSize: "18px", letterSpacing: "0.22em", fontFamily: FONT, transition: "color .2s" }}>
          {code}
        </div>
        <div style={{ color: "#2e2e2e", fontSize: "11px", marginTop: "3px", fontFamily: FONT }}>
          {label} {copied && <span style={{ color: ACCENT }}>· copié ✓</span>}
        </div>
      </button>

      {confirmDel ? (
        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
          <button onClick={onDelete} className="gm-btn" style={S.btnGhost(RED)}>OUI</button>
          <button onClick={() => setConfirmDel(false)} className="gm-btn" style={S.btnGhost("#444")}>NON</button>
        </div>
      ) : (
        <button onClick={() => setConfirmDel(true)} className="gm-btn" style={{ ...S.btnGhost(RED), padding: "10px 14px", flexShrink: 0 }}>
          SUPPR
        </button>
      )}
    </div>
  );
}

// ─── Notif Item ───────────────────────────────────────────────────────────────
const NOTIF_META: Record<string, { icon: string; color: string; label: string }> = {
  client_waiting: { icon: "◈", color: ACCENT,  label: "NOUVEAU CLIENT" },
  client_ring:    { icon: "🔔", color: ORANGE, label: "APPEL CLIENT" },
  session_ended:  { icon: "✕",  color: RED,    label: "SESSION FERMÉE" },
  peer_left:      { icon: "◉",  color: "#444", label: "PAIR DÉCONNECTÉ" },
};

function NotifItem({ notif, delay }: { notif: AdminNotif; delay: number }) {
  const meta = NOTIF_META[notif.type] ?? { icon: "·", color: "#444", label: notif.type };
  const sub = "code" in notif && notif.code
    ? `${notif.code}${"label" in notif && notif.label ? ` · ${notif.label}` : ""}`
    : `${notif.roomId.slice(0, 10)}...`;

  return (
    <div className="gm-notif" style={{
      display: "flex",
      alignItems: "center",
      gap: "14px",
      padding: "14px 20px",
      borderBottom: "1px solid #0f0f0f",
      animationDelay: `${delay}ms`,
    }}>
      <span style={{
        fontSize: "20px",
        color: meta.color,
        animation: notif.type === "client_ring" ? "gm-ring 1.4s ease infinite" : undefined,
      }}>{meta.icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ color: meta.color, fontSize: "10px", letterSpacing: "0.14em", fontWeight: "bold" }}>
          {meta.label}
        </div>
        <div style={{ color: "#3e3e3e", fontSize: "12px", marginTop: "3px", fontFamily: FONT }}>
          {sub}
        </div>
      </div>
      <div style={{ color: "#222", fontSize: "10px", fontFamily: FONT, flexShrink: 0 }}>
        {formatTime(notif.ts)}
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ icon, label, sub }: { icon: string; label: string; sub: string }) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "64px 32px",
      gap: "12px",
    }}>
      <div style={{ color: "#1c1c1c", fontSize: "40px", animation: "gm-pulse 2.5s ease-in-out infinite" }}>{icon}</div>
      <div style={{ color: "#2a2a2a", fontSize: "13px", letterSpacing: "0.12em" }}>{label}</div>
      <div style={{ color: "#1c1c1c", fontSize: "11px" }}>{sub}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN CHAT — Premium Messaging UI
// ═══════════════════════════════════════════════════════════════════════════

interface ChatProps {
  roomId: string;
  token: string;
  clientCode: string;
  clientLabel?: string;
  secure: boolean;
  onBack: () => void;
}

export function AdminChatMobile({ roomId, token, clientCode, clientLabel, secure, onBack }: ChatProps) {
  const chat = useGhostChat(roomId, "admin");
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [showVerif, setShowVerif] = useState(true);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages]);

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  // Auto-hide verif panel after established
  useEffect(() => {
    if (chat.verification && chat.status === "secure") {
      const t = setTimeout(() => setShowVerif(false), 8000);
      return () => clearTimeout(t);
    }
  }, [chat.verification, chat.status]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || chat.status !== "secure") return;
    setDraft("");
    await chat.send(text);
    textareaRef.current?.focus();
  }, [draft, chat]);

  const handleCopyCode = async () => {
    const ok = await copyToClipboard(clientCode);
    if (!ok) return;
    if (copyTimer.current) clearTimeout(copyTimer.current);
    setCopied(true);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  const handleEnd = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/admin/end-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomId }),
      });
    } catch {}
    chat.end();
    onBack();
  }, [token, roomId, chat, onBack]);

  const handleBack = useCallback(() => {
    chat.end();
    onBack();
  }, [chat, onBack]);

  const isSecure = chat.status === "secure";
  const isClosed = chat.status === "closed" || chat.status === "error";
  const isWaiting = !isSecure && !isClosed;

  const statusInfo: Record<string, { label: string; color: string }> = {
    idle:        { label: "ATTENTE",     color: "#2a2a2a" },
    connecting:  { label: "CONNEXION",  color: "#444" },
    signaling:   { label: "SIGNALING",  color: "#555" },
    handshaking: { label: "HANDSHAKE",  color: ACCENT },
    secure:      { label: "SÉCURISÉ",   color: ACCENT },
    closed:      { label: "TERMINÉ",    color: RED },
    error:       { label: "ERREUR",     color: RED },
  };
  const si = statusInfo[chat.status] ?? { label: chat.status, color: "#444" };

  return (
    <div style={{
      background: BG,
      fontFamily: FONT,
      height: "100dvh",
      display: "flex",
      flexDirection: "column",
      paddingTop: SAFE_AREA_TOP,
    }}>
      <style>{GLOBAL_CSS}</style>

      {/* ── Header ── */}
      <div style={{
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        borderBottom: "1px solid #141414",
        flexShrink: 0,
        background: BG,
      }}>
        {/* Back */}
        <button
          onClick={handleBack}
          className="gm-btn"
          style={{
            background: "#0f0f0f",
            border: "1px solid #1c1c1c",
            color: "#888",
            borderRadius: "12px",
            padding: "10px 14px",
            fontSize: "16px",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >‹</button>

        {/* Client info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            color: "#d0d0d0",
            fontSize: "15px",
            letterSpacing: "0.04em",
            fontWeight: "bold",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>{clientLabel || "Client"}</div>
          <button onClick={handleCopyCode} style={{
            background: "none", border: "none", padding: 0, cursor: "pointer",
            display: "flex", alignItems: "center", gap: "5px",
          }}>
            <span style={{ color: "#2a2a2a", fontSize: "11px", letterSpacing: "0.16em", fontFamily: FONT }}>
              {clientCode}
            </span>
            <span style={{ color: copied ? ACCENT : "#222", fontSize: "12px", transition: "color .2s" }}>
              {copied ? "✓" : "⊕"}
            </span>
          </button>
        </div>

        {/* Status + security */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0 }}>
          <span style={S.badge(secure ? ACCENT : ORANGE)}>
            {secure ? "⚡" : "⚠"} {secure ? "E2E" : "INSECURE"}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <span style={{
              width: "6px", height: "6px", borderRadius: "50%",
              background: si.color,
              animation: isWaiting ? "gm-pulse 1.2s ease-in-out infinite" : undefined,
            }} />
            <span style={{ color: si.color, fontSize: "9px", letterSpacing: "0.1em" }}>{si.label}</span>
          </div>
        </div>
      </div>

      {/* ── Verification Banner ── */}
      {chat.verification && (
        <div style={{
          margin: "10px 16px 0",
          padding: "12px 14px",
          background: `${ACCENT}08`,
          border: `1px solid ${ACCENT}22`,
          borderRadius: "14px",
          flexShrink: 0,
          overflow: "hidden",
          maxHeight: showVerif ? "80px" : "32px",
          transition: "max-height .3s ease",
        }}>
          <button
            onClick={() => setShowVerif(v => !v)}
            style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
          >
            <span style={{ color: ACCENT, fontSize: "9px", letterSpacing: "0.16em" }}>CODE DE VÉRIFICATION</span>
            <span style={{ color: "#2e2e2e", fontSize: "14px" }}>{showVerif ? "▲" : "▼"}</span>
          </button>
          {showVerif && (
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "8px" }}>
              <span style={{ fontSize: "24px", letterSpacing: "6px" }}>{chat.verification.emojis}</span>
              <span style={{ color: ACCENT, fontSize: "15px", letterSpacing: "0.18em" }}>{chat.verification.hex}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Error ── */}
      {chat.error && (
        <div style={{
          margin: "10px 16px 0",
          padding: "12px 14px",
          background: `${RED}0c`,
          border: `1px solid ${RED}28`,
          borderRadius: "14px",
          color: RED,
          fontSize: "12px",
          flexShrink: 0,
        }}>⚠ {chat.error}</div>
      )}

      {/* ── Ring Ack Toast ── */}
      {chat.ringAcked && (
        <div style={{
          margin: "10px 16px 0",
          padding: "12px 14px",
          background: `${ORANGE}0c`,
          border: `1px solid ${ORANGE}28`,
          borderRadius: "14px",
          color: ORANGE,
          fontSize: "12px",
          textAlign: "center",
          flexShrink: 0,
        }}>🔔 Appel envoyé au client</div>
      )}

      {/* ── Messages ── */}
      {isWaiting && chat.messages.length === 0 ? (
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "20px",
        }}>
          <div style={{ position: "relative", width: "40px", height: "40px" }}>
            <div style={{
              position: "absolute", inset: 0,
              border: `2px solid ${ACCENT}15`,
              borderTop: `2px solid ${ACCENT}`,
              borderRadius: "50%",
              animation: "gm-spin 1.1s linear infinite",
            }} />
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: "#2a2a2a", fontSize: "13px", letterSpacing: "0.12em" }}>{si.label}</div>
            <div style={{ color: "#1a1a1a", fontSize: "11px", marginTop: "6px" }}>En attente du client...</div>
          </div>
        </div>
      ) : (
        <div style={{
          flex: 1,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        }}>
          {chat.messages.map((m, i) => {
            const showTime = i === 0 || (m.ts - chat.messages[i - 1].ts) > 5 * 60_000;
            return (
              <div key={m.id}>
                {showTime && (
                  <div style={{ textAlign: "center", color: "#222", fontSize: "10px", margin: "10px 0 6px", letterSpacing: "0.06em" }}>
                    {formatTime(m.ts)}
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", alignItems: m.self ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "78%",
                    background: m.self
                      ? `linear-gradient(135deg, #0e1a00, #121e00)`
                      : BG3,
                    border: `1px solid ${m.self ? ACCENT + "22" : "#1e1e1e"}`,
                    borderRadius: m.self
                      ? "18px 18px 4px 18px"
                      : "18px 18px 18px 4px",
                    padding: "11px 14px",
                  }}>
                    {!m.self && (
                      <div style={{ color: "#3a3a3a", fontSize: "9px", letterSpacing: "0.1em", marginBottom: "5px" }}>
                        {clientLabel || "CLIENT"}
                      </div>
                    )}
                    <div style={{
                      fontSize: "15px",
                      color: m.self ? "#d8e8b0" : "#cccccc",
                      lineHeight: "1.55",
                      wordBreak: "break-word",
                      whiteSpace: "pre-wrap",
                    }}>{m.text}</div>
                  </div>
                </div>
              </div>
            );
          })}

          {isClosed && (
            <div style={{ textAlign: "center", color: "#1e1e1e", fontSize: "11px", margin: "24px 0 8px", letterSpacing: "0.14em" }}>
              ─── SESSION TERMINÉE ───
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* ── Input Footer ── */}
      {!isClosed ? (
        <div style={{
          padding: `12px 16px calc(${SAFE_AREA_BOTTOM} + 12px)`,
          borderTop: "1px solid #141414",
          background: BG2,
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
            <textarea
              ref={textareaRef}
              className="gm-input"
              rows={1}
              placeholder={isSecure ? "Message chiffré E2E..." : "En attente de connexion..."}
              value={draft}
              disabled={!isSecure}
              onChange={e => {
                setDraft(e.target.value);
                // auto-grow
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
              }}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              style={{
                ...S.input({
                  flex: 1,
                  minHeight: "50px",
                  maxHeight: "120px",
                  lineHeight: "1.45",
                  paddingTop: "14px",
                  paddingBottom: "14px",
                  fontSize: "15px",
                  resize: "none",
                  opacity: isSecure ? 1 : 0.4,
                }),
              }}
            />
            {/* Send */}
            <button
              onClick={handleSend}
              disabled={!isSecure || !draft.trim()}
              className="gm-btn"
              style={{
                width: "50px",
                height: "50px",
                borderRadius: "14px",
                background: isSecure && draft.trim() ? ACCENT : "#111",
                border: "none",
                color: isSecure && draft.trim() ? BG : "#2a2a2a",
                fontSize: "20px",
                cursor: isSecure && draft.trim() ? "pointer" : "default",
                flexShrink: 0,
                transition: "background .15s, color .15s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >↑</button>
          </div>

          {/* End session row */}
          <div style={{ marginTop: "8px", display: "flex", justifyContent: "center" }}>
            {confirmEnd ? (
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={handleEnd} className="gm-btn" style={{ ...S.btnGhost(RED), fontSize: "11px" }}>
                  CONFIRMER FIN
                </button>
                <button onClick={() => setConfirmEnd(false)} className="gm-btn" style={{ ...S.btnGhost("#444"), fontSize: "11px" }}>
                  ANNULER
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmEnd(true)} className="gm-btn" style={{ ...S.btnGhost(RED), fontSize: "11px", padding: "8px 20px" }}>
                ✕ TERMINER LA SESSION
              </button>
            )}
          </div>
        </div>
      ) : (
        <div style={{ padding: `14px 16px calc(${SAFE_AREA_BOTTOM} + 14px)`, background: BG2, flexShrink: 0 }}>
          <button onClick={onBack} className="gm-btn" style={S.btnPrimary(false)}>
            ‹ RETOUR AU TABLEAU DE BORD
          </button>
        </div>
      )}
    </div>
  );
}
