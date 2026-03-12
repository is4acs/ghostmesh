// ─── Shared Design Tokens ────────────────────────────────────────────────────

export const ACCENT  = "#C8FF00";
export const BG      = "#070707";
export const BG2     = "#0f0f0f";
export const BG3     = "#161616";
export const RED     = "#FF3B30";
export const ORANGE  = "#FF9500";
export const FONT    = "'Courier New', Courier, monospace";

// ─── Mobile-First Helpers ────────────────────────────────────────────────────

export const SAFE_AREA_TOP    = "env(safe-area-inset-top)";
export const SAFE_AREA_BOTTOM = "env(safe-area-inset-bottom)";
export const SAFE_AREA_LEFT   = "env(safe-area-inset-left)";
export const SAFE_AREA_RIGHT  = "env(safe-area-inset-right)";

export function mobileInputStyle(): React.CSSProperties {
  return {
    background: BG3,
    border: "1px solid #2a2a2a",
    color: "#e0e0e0",
    fontFamily: FONT,
    fontSize: "16px",
    padding: "14px 16px",
    borderRadius: "12px",
    width: "100%",
    outline: "none",
    WebkitAppearance: "none",
    WebkitTapHighlightColor: "transparent",
  };
}

export function mobileBtnStyle(primary = true, disabled = false): React.CSSProperties {
  return {
    background: primary ? ACCENT : "transparent",
    color: primary ? BG : "#888",
    border: primary ? "none" : "1px solid #333",
    borderRadius: "12px",
    padding: "16px 24px",
    fontFamily: FONT,
    fontSize: "14px",
    fontWeight: "bold",
    cursor: disabled ? "not-allowed" : "pointer",
    letterSpacing: "0.08em",
    opacity: disabled ? 0.4 : 1,
    WebkitTapHighlightColor: "transparent",
    transition: "transform 0.1s, opacity 0.1s",
  };
}

export function mobileCardStyle(): React.CSSProperties {
  return {
    background: BG2,
    border: "1px solid #1a1a1a",
    borderRadius: "16px",
    padding: "16px",
  };
}

// ─── Shared Constants ─────────────────────────────────────────────────────────

export const RING_DURATION_MS  = 3_000;
export const NOTIF_CAP         = 100;
export const TTL_MS            = 10 * 60 * 1_000; // must match server

// ─── Shared Utilities ─────────────────────────────────────────────────────────

/** Build a ws:// / wss:// URL that respects the current protocol. */
export function wsUrl(path: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${path}`;
}

/** Format a Unix timestamp to HH:MM:SS in French locale. */
export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Format milliseconds to MM:SS countdown string. */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00";
  const totalSec = Math.floor(ms / 1_000);
  const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

/** Play a brief bell tone via Web Audio API (no external deps). */
export function playBell(): void {
  try {
    const ctx = new AudioContext();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.25);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
    // auto-close context after tone finishes
    setTimeout(() => ctx.close(), 600);
  } catch {
    // AudioContext unavailable (e.g. in test env) — silently ignore
  }
}

/** Copy text to clipboard, returning whether it succeeded. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ─── Shared Style Helpers ─────────────────────────────────────────────────────

/** Standard error/alert box style. */
export function errorBoxStyle(color: string = RED): React.CSSProperties {
  return {
    padding: "10px 14px",
    border: `1px solid ${color}44`,
    borderRadius: "4px",
    background: `${color}0d`,
    fontSize: "11px",
    color,
    letterSpacing: "0.05em",
  };
}

/** Standard accent badge style. */
export function badgeStyle(color: string): React.CSSProperties {
  return {
    fontSize: "10px",
    padding: "3px 8px",
    border: `1px solid ${color}33`,
    borderRadius: "2px",
    background: `${color}0d`,
    color,
    letterSpacing: "0.08em",
  };
}

// Make React available for CSSProperties type
import type React from "react";
