import { useState } from "react";
import { ChatApp } from "./ui/ChatApp";
import { AdminLogin } from "./ui/AdminLogin";
import { AdminDashboard } from "./ui/AdminDashboard";
import { ACCENT, BG, BG2, BG3, FONT, errorBoxStyle } from "./theme";

// ─── Types ────────────────────────────────────────────────────────────────────

type Screen =
  | { type: "client_landing" }
  | { type: "client_chat"; roomId: string; secure: boolean }
  | { type: "admin_login" }
  | { type: "admin_dashboard"; token: string }
  | { type: "admin_chat"; roomId: string; token: string; clientCode: string; clientLabel?: string; secure: boolean };

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const isAdminRoute = window.location.pathname.startsWith("/admin");
  const [screen, setScreen] = useState<Screen>(
    isAdminRoute ? { type: "admin_login" } : { type: "client_landing" }
  );

  // ── Admin routing ────────────────────────────────────────────────────────
  if (screen.type === "admin_login") {
    return (
      <AdminLogin
        onLogin={(token) => setScreen({ type: "admin_dashboard", token })}
      />
    );
  }

  if (screen.type === "admin_dashboard") {
    return (
      <AdminDashboard
        token={screen.token}
        onJoinSession={(session) =>
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

  // ── Client routing ───────────────────────────────────────────────────────
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

  // ── Client Landing ───────────────────────────────────────────────────────
  return (
    <ClientLanding
      onJoin={(roomId, secure) =>
        setScreen({ type: "client_chat", roomId, secure })
      }
      onAdminClick={() => setScreen({ type: "admin_login" })}
    />
  );
}

// ─── Client Landing ───────────────────────────────────────────────────────────

function ClientLanding({
  onJoin,
  onAdminClick,
}: {
  onJoin: (roomId: string, secure: boolean) => void;
  onAdminClick: () => void;
}) {
  const [codeInput, setCodeInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (!res.ok) { setError("Serveur inaccessible"); setLoading(false); return; }
      const data = await res.json() as { roomId: string; secure: boolean };
      onJoin(data.roomId, data.secure);
    } catch {
      setError("Connexion impossible");
    } finally {
      setLoading(false);
    }
  };

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
        background: BG,
        fontFamily: FONT,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}>
        <div style={{ width: "100%", maxWidth: "380px", display: "flex", flexDirection: "column", gap: "28px" }}>

          {/* Logo */}
          <div style={{ textAlign: "center" }}>
            <div style={{ color: ACCENT, fontSize: "22px", letterSpacing: "0.2em", fontWeight: "bold" }}>
              ⬡ GHOSTMESH
            </div>
            <div style={{ color: "#2a2a2a", fontSize: "10px", letterSpacing: "0.15em", marginTop: "6px" }}>
              MESSAGERIE CHIFFRÉE · E2E · P2P
            </div>
          </div>

          {/* Code input */}
          <div style={{
            background: BG2,
            border: "1px solid #1a1a1a",
            borderRadius: "10px",
            padding: "24px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
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
            <div style={{ color: "#333", fontSize: "10px", textAlign: "center" }}>
              Entrez le code fourni par votre vendeur (JJMMAAAA)
            </div>
            <button
              onClick={handleConnect}
              disabled={loading}
              style={{
                background: ACCENT,
                color: BG,
                border: "none",
                borderRadius: "4px",
                padding: "14px",
                fontFamily: FONT,
                fontSize: "13px",
                fontWeight: "bold",
                cursor: loading ? "not-allowed" : "pointer",
                letterSpacing: "0.1em",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? "CONNEXION..." : "SE CONNECTER"}
            </button>
          </div>

          {error && <div style={errorBoxStyle()}>{error}</div>}

          {/* Admin link */}
          <div style={{ textAlign: "center" }}>
            <button
              onClick={onAdminClick}
              style={{
                background: "transparent",
                border: "none",
                color: "#2a2a2a",
                fontSize: "10px",
                cursor: "pointer",
                fontFamily: FONT,
                letterSpacing: "0.1em",
                textDecoration: "underline",
              }}
            >
              accès admin
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

