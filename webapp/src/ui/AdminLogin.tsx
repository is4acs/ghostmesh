import { useState } from "react";
import { ACCENT, BG, BG2, BG3, FONT, errorBoxStyle, API_BASE } from "../theme";

interface Props {
  onLogin: (token: string) => void;
}

export function AdminLogin({ onLogin }: Props) {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!token.trim()) { setError("Token requis"); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      if (res.status === 401) { setError("Token invalide"); setLoading(false); return; }
      if (!res.ok) { setError(`Serveur inaccessible (${res.status})`); setLoading(false); return; }
      sessionStorage.setItem("ghost_admin_token", token.trim());
      onLogin(token.trim());
    } catch {
      setError("Serveur inaccessible");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: ${BG}; }
        .admin-input {
          background: ${BG3};
          border: 1px solid #2a2a2a;
          color: #e0e0e0;
          font-family: ${FONT};
          font-size: 14px;
          letter-spacing: 0.1em;
          padding: 12px 14px;
          border-radius: 4px;
          width: 100%;
          outline: none;
          transition: border-color 0.15s;
        }
        .admin-input:focus { border-color: ${ACCENT}55; }
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
        <div style={{ width: "100%", maxWidth: "340px", display: "flex", flexDirection: "column", gap: "24px" }}>

          {/* Logo */}
          <div style={{ textAlign: "center" }}>
            <div style={{ color: ACCENT, fontSize: "18px", letterSpacing: "0.2em", fontWeight: "bold" }}>
              ⬡ GHOSTMESH
            </div>
            <div style={{ color: "#333", fontSize: "10px", letterSpacing: "0.2em", marginTop: "6px" }}>
              PANNEAU ADMINISTRATEUR
            </div>
          </div>

          {/* Login card */}
          <div style={{
            background: BG2,
            border: `1px solid ${ACCENT}22`,
            borderRadius: "10px",
            padding: "24px",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
          }}>
            <div style={{ color: "#666", fontSize: "10px", letterSpacing: "0.15em" }}>
              TOKEN D'ACCÈS ADMIN
            </div>
            <input
              className="admin-input"
              type="password"
              placeholder="••••••••••••"
              value={token}
              onChange={(e) => { setToken(e.target.value); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              autoComplete="off"
            />
            <button
              onClick={handleSubmit}
              disabled={loading}
              style={{
                background: ACCENT,
                color: BG,
                border: "none",
                borderRadius: "4px",
                padding: "12px",
                fontFamily: FONT,
                fontSize: "12px",
                fontWeight: "bold",
                cursor: loading ? "not-allowed" : "pointer",
                letterSpacing: "0.1em",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? "VÉRIFICATION..." : "ACCÉDER"}
            </button>
          </div>

          {error && <div style={errorBoxStyle()}>{error}</div>}

          <div style={{ textAlign: "center", color: "#1e1e1e", fontSize: "10px" }}>
            Token par défaut : GHOST_ADMIN
          </div>
        </div>
      </div>
    </>
  );
}
