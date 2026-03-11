import type { CapacitorConfig } from '@capacitor/cli';

// URL de ton serveur Railway en production.
// L'APK charge directement depuis ce domaine → toujours à jour sans rebuild APK.
const PRODUCTION_URL = process.env.CAPACITOR_SERVER_URL ?? "https://ghostmesh-production.up.railway.app";

const config: CapacitorConfig = {
  appId:   "com.ghostmesh.app",
  appName: "GhostMesh",
  webDir:  "dist",

  // Mode "remote URL" : le WebView charge l'app depuis le serveur Railway.
  // Avantages : APK léger, mises à jour instantanées sans redistribution.
  server: {
    url:       PRODUCTION_URL,
    cleartext: false,             // Force HTTPS uniquement
  },

  android: {
    // Nécessaire pour WebRTC + Web Crypto API dans la WebView Android
    allowMixedContent:           false,
    captureInput:                true,
    webContentsDebuggingEnabled: false, // passer à true en dev si besoin

    // Couleurs système
    backgroundColor: "#070707",
  },
};

export default config;
