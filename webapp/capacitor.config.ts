import type { CapacitorConfig } from '@capacitor/core';

const config: CapacitorConfig = {
  appId:   "com.ghostmesh.app",
  appName: "GhostMesh",
  webDir:  "dist",

  // Mode local : l'APK contient tous les assets
  // L'app fonctionne hors-ligne et détecte correctement le mode natif
  server: {
    androidScheme: "https",
  },

  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    backgroundColor: "#070707",
  },
};

export default config;
