import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  // basicSsl génère un certificat auto-signé → active crypto.subtle sur toutes les origines
  plugins: [react(), basicSsl()],
  server: {
    port: 5173,
    host: true,          // expose sur 0.0.0.0 → accessible depuis le réseau local
    https: true,         // HTTPS requis pour Web Crypto API (crypto.subtle) hors localhost
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
});
