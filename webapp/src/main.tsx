import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// ── CSS natif GrapheneOS ──────────────────────────────────────────────────────
// Injecté uniquement sur la plateforme native (Capacitor Android).
// Règles ciblées : safe areas, overscroll, sélection texte, momentum scroll.
const style = document.createElement("style");
style.textContent = `
  :root {
    --sat: env(safe-area-inset-top,    0px);
    --sab: env(safe-area-inset-bottom, 0px);
    --sal: env(safe-area-inset-left,   0px);
    --sar: env(safe-area-inset-right,  0px);
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background: #070707;
    /* Désactive le pull-to-refresh et le bounce (natif Android) */
    overscroll-behavior: none;
    /* Momentum scroll fluide sur Android WebView */
    -webkit-overflow-scrolling: touch;
    /* Désactive le zoom pinch — l'app n'est pas un site web */
    touch-action: pan-x pan-y;
  }
  /* Applique les safe areas au root pour notch / barre de navigation */
  #root {
    padding-top:    var(--sat);
    padding-bottom: var(--sab);
    padding-left:   var(--sal);
    padding-right:  var(--sar);
    min-height: 100dvh;
  }
  /* Boutons : cible minimum 48dp (recommandation Material / GrapheneOS) */
  button {
    min-height: 48px;
    min-width:  48px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    /* Pas de flash bleu au touch sur Android */
  }
  /* Désactive la sélection de texte sur les éléments d'interface */
  button, label, nav, header {
    -webkit-user-select: none;
    user-select: none;
  }
  /* Input : hauteur confortable sur mobile */
  input, textarea {
    font-size: 16px; /* empêche le zoom auto iOS/Android */
    min-height: 48px;
  }
  /* Scrollable : scroll fluide */
  [data-scroll] {
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
  }
`;
document.head.appendChild(style);

// ─────────────────────────────────────────────────────────────────────────────

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
