import { useState } from "react";
import { AdminLoginMobile, AdminDashboardMobile, AdminChatMobile } from "./ui/AdminMobile";
import { ChatApp } from "./ui/ChatApp";
import { AdminLogin } from "./ui/AdminLogin";
import { AdminDashboard } from "./ui/AdminDashboard";
import { ACCENT, BG, BG2, BG3, FONT, ORANGE, errorBoxStyle } from "./theme";
import type { AdminSession } from "./hooks/useAdminSocket";

// ─── Types ────────────────────────────────────────────────────────────────────

type NativeScreen =
  | { type: "admin_login" }
  | { type: "admin_dashboard"; token: string }
  | { type: "admin_chat"; roomId: string; token: string; clientCode: string; clientLabel?: string; secure: boolean };

type WebScreen =
  | { type: "client_landing" }
  | { type: "client_chat"; roomId: string; secure: boolean }
  | { type: "admin_login" }
  | { type: "admin_dashboard"; token: string }
  | { type: "admin_chat"; roomId: string; token: string; clientCode: string; clientLabel?: string; secure: boolean };

// APK: Capacitor loads from https://localhost (androidScheme: "https")
const IS_NATIVE = location.hostname === "localhost";

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  if (IS_NATIVE) return <NativeAdminApp />;
  return <WebApp />;
}

// ─── Native (APK) — Always admin mobile UI ───────────────────────────────────

function NativeAdminApp() {
  const [screen, setScreen] = useState<NativeScreen>({ type: "admin_login" });
  const [token, setToken] = useState<string>(() => sessionStorage.getItem("ghost_admin_token") || "");

  const handleLogin = (t: string) => {
    sessionStorage.setItem("ghost_admin_token", t);
    setToken(t);
    setScreen({ type: "admin_dashboard", token: t });
  };

  if (!token || screen.type === "admin_login") {
    return <AdminLoginMobile onLogin={handleLogin} />;
  }
  if (screen.type === "admin_dashboard") {
    return (
      <AdminDashboardMobile
        token={token}
        onJoinSession={(session: AdminSession) =>
          setScreen({
            type: "admin_chat",
            roomId: session.roomId,
            token,
            clientCode: session.clientCode,
            clientLabel: session.clientLabel,
            secure: session.secure,
          })
        }
      />
    );
  }
  if (screen.type === "admin_chat") {
    return (
      <AdminChatMobile
        roomId={screen.roomId}
        token={token}
        clientCode={screen.clientCode}
        clientLabel={screen.clientLabel}
        secure={screen.secure}
        onBack={() => setScreen({ type: "admin_dashboard", token })}
      />
    );
  }
  return <AdminLoginMobile onLogin={handleLogin} />;
}

// ─── Web — Client landing + web admin ────────────────────────────────────────

function WebApp() {
  const isAdminRoute = window.location.pathname.startsWith("/admin");
  const [screen, setScreen] = useState<WebScreen>(
    isAdminRoute ? { type: "admin_login" } : { type: "client_landing" }
  );

  if (screen.type === "admin_login") {
    return <AdminLogin onLogin={(token) => setScreen({ type: "admin_dashboard", token })} />;
  }
  if (screen.type === "admin_dashboard") {
    return (
      <AdminDashboard
        token={screen.token}
        onJoinSession={(session: AdminSession) =>
          setScreen({
            type: "admin_chat",
            roomId: session.roomId,
            token: screen.token,
            clientCode: session.clientCode,
            clientLabel: session.clientLabel,
            secure: session.secure,
          })
        }
      />
    );
  }
  if (screen.type === "admin_chat") {
    return (
      <ChatApp
        roomId={screen.roomId}
        role="admin"
        secure={screen.secure}
        adminInfo={{ code: screen.clientCode, label: screen.clientLabel, token: screen.token }}
        onBack={() => setScreen({ type: "admin_dashboard", token: screen.token })}
      />
    );
  }
  if (screen.type === "client_chat") {
    return (
      <ChatApp
        roomId={screen.roomId}
        role="client"
        secure={screen.secure}
        onBack={() => setScreen({ type: "client_landing" })}
      />
    );
  }
  return (
    <ClientLanding
      onJoin={(roomId, secure) => setScreen({ type: "client_chat", roomId, secure })}
    />
  );
}

// ─── Client Landing ───────────────────────────────────────────────────────────

function ClientLanding({ onJoin }: { onJoin: (roomId: string, secure: boolean) => void }) {
  const [codeInput, setCodeInput] = useState("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [pendingInsecure, setPendingInsecure] = useState<{ roomId: string } | null>(null);

  const handleConnect = async () => {
    const code = codeInput.trim();
    if (code.length === 0) { setError("Entrez votre code"); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/client/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (res.status === 403) { setError("Code invalide"); setLoading(false); return; }
      if (!res.ok)            { setError("Serveur inaccessible"); setLoading(false); return; }
      const data = await res.json() as { roomId: string; secure: boolean };
      if (!data.secure) {
        setPendingInsecure({ roomId: data.roomId });
      } else {
        onJoin(data.roomId, true);
      }
    } catch {
      setError("Connexion impossible");
    } finally {
      setLoading(false);
    }
  };

  if (pendingInsecure) {
    return (
      <div style={{
        background: BG, fontFamily: FONT, minHeight: "100vh",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", padding: "24px",
      }}>
        <div style={{ width: "100%", maxWidth: "380px", display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ textAlign: "center", color: ACCENT, fontSize: "22px", letterSpacing: "0.2em", fontWeight: "bold" }}>
            ⬡ GHOSTMESH
          </div>
          <div style={{
            background: "#1a0e00", border: `1px solid ${ORANGE}44`,
            borderRadius: "10px", padding: "28px",
            display: "flex", flexDirection: "column", gap: "18px", alignItems: "center",
          }}>
            <div style={{ fontSize: "32px" }}>⚠</div>
            <div style={{ color: ORANGE, fontSize: "13px", fontWeight: "bold", letterSpacing: "0.12em" }}>
              SESSION NON SÉCURISÉE
            </div>
            <div style={{ color: "#886633", fontSize: "11px", lineHeight: "1.8", textAlign: "center" }}>
              Vous utilisez un code d'accès général.<br />
              Votre identité ne peut pas être vérifiée.<br />
              Cette conversation n'est pas confidentielle.
            </div>
            <button
              onClick={() => onJoin(pendingInsecure.roomId, false)}
              style={{
                background: ORANGE, color: BG, border: "none", borderRadius: "4px",
                padding: "14px 24px", fontFamily: FONT, fontSize: "13px",
                fontWeight: "bold", cursor: "pointer", letterSpacing: "0.1em", width: "100%",
              }}
            >
              CONTINUER QUAND MÊME
            </button>
            <button
              onClick={() => setPendingInsecure(null)}
              style={{
                background: "transparent", color: "#555", border: "1px solid #2a2a2a",
                borderRadius: "4px", padding: "10px", fontFamily: FONT,
                fontSize: "11px", cursor: "pointer", letterSpacing: "0.1em", width: "100%",
              }}
            >
              ANNULER
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: ${BG}; }
        .code-inp {
          background: ${BG3};
          border: 1px solid #2a2a2a;
          color: ${ACCENT};
          font-family: ${FONT};
          font-size: 32px;
          font-weight: bold;
          letter-spacing: 0.5em;
          text-align: center;
          padding: 16px 20px;
          border-radius: 6px;
          width: 100%;
          outline: none;
          transition: border-color 0.15s;
        }
        .code-inp:focus { border-color: ${ACCENT}66; }
        .code-inp::placeholder { color: #222; letter-spacing: 0.3em; font-size: 24px; }
        button:hover { opacity: 0.85; }
      `}</style>
      <div style={{
        background: BG, fontFamily: FONT, minHeight: "100vh",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", padding: "24px",
      }}>
        <div style={{ width: "100%", maxWidth: "380px", display: "flex", flexDirection: "column", gap: "28px" }}>

          <div style={{ textAlign: "center" }}>
            <div style={{ color: ACCENT, fontSize: "22px", letterSpacing: "0.2em", fontWeight: "bold" }}>
              ⬡ GHOSTMESH
            </div>
          </div>

          <div style={{
            background: BG2, border: "1px solid #1a1a1a", borderRadius: "10px",
            padding: "24px", display: "flex", flexDirection: "column", gap: "16px",
          }}>
            <div style={{ color: "#555", fontSize: "10px", letterSpacing: "0.15em" }}>
              CODE D'ACCÈS
            </div>
            <input
              className="code-inp"
              type="text"
              inputMode="numeric"
              placeholder="••••••••"
              maxLength={8}
              value={codeInput}
              onChange={(e) => {
                setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 8));
                setError(null);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") handleConnect(); }}
            />
            <button
              onClick={handleConnect}
              disabled={loading}
              style={{
                background: ACCENT, color: BG, border: "none", borderRadius: "4px",
                padding: "14px", fontFamily: FONT, fontSize: "13px", fontWeight: "bold",
                cursor: loading ? "not-allowed" : "pointer", letterSpacing: "0.1em",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? "CONNEXION..." : "SE CONNECTER"}
            </button>
          </div>

          {error && <div style={errorBoxStyle()}>{error}</div>}
        </div>
      </div>
    </>
  );
}
