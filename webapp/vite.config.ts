import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// basicSsl uniquement en dev local (Railway fournit HTTPS automatiquement)
const isDev = process.env.NODE_ENV !== "production";

export default defineConfig(async () => {
  const plugins = [react()];
  if (isDev) {
    const { default: basicSsl } = await import("@vitejs/plugin-basic-ssl");
    plugins.push(basicSsl() as never);
  }
  return {
  // basicSsl génère un certificat auto-signé → active crypto.subtle sur toutes les origines
  plugins,
  server: {
    port: 5173,
    host: true,          // expose sur 0.0.0.0 → accessible depuis le réseau local
    https: isDev,        // HTTPS requis pour Web Crypto API (crypto.subtle) hors localhost
    proxy: {
      // WebSocket channels — toujours proxifiés (wss:// automatique côté client car HTTPS)
      "/signal": {
        target: "ws://localhost:3000",
        ws: true,
        changeOrigin: true,
        rewriteWsOrigin: true,
      },
      "/admin-ws": {
        target: "ws://localhost:3000",
        ws: true,
        changeOrigin: true,
        rewriteWsOrigin: true,
      },

      // Admin REST API — proxy uniquement les requêtes non-HTML
      "/admin": {
        target: "http://localhost:3000",
        changeOrigin: true,
        bypass(req) {
          if (req.headers.accept?.includes("text/html")) return "/index.html";
          return null;
        },
      },

      // Client REST API
      "/client": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  };
});
