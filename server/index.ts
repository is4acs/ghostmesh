import { createServer, IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { URL } from "url";
import { readFileSync, existsSync, statSync } from "fs";
import { join, extname, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

const PORT = Number(process.env.PORT ?? 3000);

// ─── Supabase ─────────────────────────────────────────────────────────────────
// Variables requises : SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (dans .env / Railway)
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const db = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

if (!db) {
  console.warn("⚠  Supabase non configuré — stockage en mémoire uniquement");
}

// ─── Firebase FCM ──────────────────────────────────────────────────────────────
const FIREBASE_SA = process.env.FIREBASE_SERVICE_ACCOUNT ?? "";
let fcmMessaging: ReturnType<typeof getMessaging> | null = null;
if (FIREBASE_SA) {
  try {
    const sa = JSON.parse(FIREBASE_SA);
    const app = getApps().length === 0 ? initializeApp({ credential: cert(sa) }) : getApps()[0];
    fcmMessaging = getMessaging(app);
    console.log("[FCM] Firebase Admin initialisé ✓");
  } catch (e) {
    console.error("[FCM] Erreur initialisation:", e);
  }
} else {
  console.warn("⚠  FCM non configuré — FIREBASE_SERVICE_ACCOUNT manquant");
}

// Tokens FCM des appareils admin — chargés depuis Supabase au démarrage
const fcmTokens = new Set<string>();

// Charger les tokens persistés au démarrage
(async () => {
  if (!db) return;
  try {
    const { data, error } = await db.from("fcm_tokens").select("token");
    if (error) { console.error("[FCM] Erreur chargement tokens:", error.message); return; }
    for (const row of data ?? []) fcmTokens.add(row.token);
    console.log(`[FCM] ${fcmTokens.size} token(s) chargé(s) depuis Supabase`);
  } catch (e) { console.error("[FCM] Erreur chargement tokens:", e); }
})();

async function saveFcmToken(token: string): Promise<void> {
  fcmTokens.add(token);
  if (!db) return;
  try {
    await db.from("fcm_tokens").upsert({ token }, { onConflict: "token" });
  } catch (e) { console.error("[FCM] Erreur sauvegarde token:", e); }
}

async function sendFcmPush(title: string, body: string): Promise<void> {
  if (!fcmMessaging) { console.warn("[FCM] fcmMessaging null — Firebase non initialisé"); return; }
  if (fcmTokens.size === 0) { console.warn("[FCM] Aucun token enregistré"); return; }
  console.log(`[FCM] Envoi push à ${fcmTokens.size} appareil(s): "${title}"`);
  for (const token of [...fcmTokens]) {
    try {
      const msgId = await fcmMessaging.send({
        token,
        notification: { title, body },
        android: { priority: "high", notification: { sound: "default", channelId: "ghostmesh_alerts" } },
      });
      console.log("[FCM] Push envoyé ✓ messageId:", msgId);
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === "messaging/registration-token-not-registered") {
        console.warn("[FCM] Token invalide, suppression:", token.substring(0, 20));
        fcmTokens.delete(token);
        if (db) await db.from("fcm_tokens").delete().eq("token", token);
      } else {
        console.error("[FCM] Erreur envoi:", err.code, err.message);
      }
    }
  }
}

// Répertoire des fichiers statiques (webapp/dist après build)
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const STATIC_DIR = join(__dirname, "../webapp/dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript",
  ".css":  "text/css",
  ".ico":  "image/x-icon",
  ".png":  "image/png",
  ".svg":  "image/svg+xml",
  ".json": "application/json",
  ".woff2":"font/woff2",
  ".woff": "font/woff",
  // APK — force download au lieu d'afficher dans le navigateur
  ".apk":  "application/vnd.android.package-archive",
  ".aab":  "application/x-authorware-bin",
};

function serveStatic(res: import("http").ServerResponse, pathname: string): boolean {
  // Essaye le chemin exact, puis index.html (SPA fallback)
  const candidates = [
    join(STATIC_DIR, pathname),
    join(STATIC_DIR, pathname, "index.html"),
  ];
  for (const fp of candidates) {
    if (existsSync(fp) && statSync(fp).isFile()) {
      const ext  = extname(fp);
      const mime = MIME[ext] ?? "application/octet-stream";
      const headers: Record<string, string> = { "Content-Type": mime };
      // Force le téléchargement pour les APK (pas d'affichage navigateur)
      if (ext === ".apk") {
        headers["Content-Disposition"] = `attachment; filename="GhostMesh.apk"`;
        headers["Content-Length"] = String(statSync(fp).size);
      }
      res.writeHead(200, headers);
      res.end(readFileSync(fp));
      return true;
    }
  }
  // SPA fallback → index.html pour React Router (/admin, etc.)
  const index = join(STATIC_DIR, "index.html");
  if (existsSync(index)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFileSync(index));
    return true;
  }
  return false;
}
const TTL_MS = 10 * 60 * 1000;
const ADMIN_TOKEN: string = process.env.ADMIN_TOKEN ?? "GHOST_ADMIN";
const INSECURE_CODE: string = process.env.INSECURE_CODE ?? "00000";

// ─── Rate Limiter ──────────────────────────────────────────────────────────────
// Simple in-memory IP-based rate limiter to prevent brute-force & DoS attacks.
interface RateEntry { count: number; resetAt: number; }
const rateLimits = new Map<string, RateEntry>();

/**
 * Returns true if the request is allowed, false if the limit is exceeded.
 * @param key       Bucket key (e.g. "auth:<ip>" or "join:<ip>")
 * @param limit     Max requests per window
 * @param windowMs  Window size in milliseconds
 */
function rateAllow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  let entry = rateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + windowMs };
    rateLimits.set(key, entry);
    return true;
  }
  entry.count++;
  return entry.count <= limit;
}

// Periodically clean up expired rate-limit entries to avoid memory leak
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimits) {
    if (now > v.resetAt) rateLimits.delete(k);
  }
}, 60_000);

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim();
  return ip ?? req.socket.remoteAddress ?? "unknown";
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientCode {
  code: string;
  label: string;
  createdAt: number;
}

interface Peer {
  ws: WebSocket;
  peerId: string;
  joinedAt: number;
  role: "client" | "admin";
}

interface Room {
  peers:        Map<string, Peer>;
  timer:        ReturnType<typeof setTimeout>;
  secure:       boolean;
  clientCode:   string;
  clientLabel?: string;
  createdAt:    number;
  wsMode:       boolean;        // true when WebRTC failed → peers use WS relay
  wsPubkeySent: Set<string>;    // peerIds that have already sent ws_pubkey (prevents injection)
}

// ─── State ────────────────────────────────────────────────────────────────────

const clientCodes = new Map<string, ClientCode>();
const rooms = new Map<string, Room>();
let adminWs: WebSocket | null = null;

// ─── Supabase helpers ─────────────────────────────────────────────────────────

/** Charge les codes depuis Supabase au démarrage (best-effort). */
async function loadCodesFromDb(): Promise<void> {
  if (!db) return;
  try {
    const { data, error } = await db.from("client_codes").select("code, label, created_at");
    if (error) { console.error("[Supabase] load error:", error.message); return; }
    for (const row of data ?? []) {
      clientCodes.set(row.code, { code: row.code, label: row.label, createdAt: new Date(row.created_at).getTime() });
    }
    console.log(`[Supabase] ${clientCodes.size} code(s) chargé(s)`);
  } catch (e) {
    console.error("[Supabase] load exception:", e);
  }
}

/** Persiste un nouveau code dans Supabase (best-effort). */
async function persistCode(entry: ClientCode): Promise<void> {
  if (!db) return;
  try {
    const { error } = await db.from("client_codes").upsert({ code: entry.code, label: entry.label, created_at: new Date(entry.createdAt).toISOString() });
    if (error) console.error("[Supabase] upsert code error:", error.message);
  } catch (e) {
    console.error("[Supabase] upsert exception:", e);
  }
}

/** Supprime un code de Supabase (best-effort). */
async function deleteCodeFromDb(code: string): Promise<void> {
  if (!db) return;
  try {
    const { error } = await db.from("client_codes").delete().eq("code", code);
    if (error) console.error("[Supabase] delete code error:", error.message);
  } catch (e) {
    console.error("[Supabase] delete exception:", e);
  }
}

/** Enregistre une session terminée dans le journal d'audit. */
async function logSessionEnd(roomId: string, room: Room): Promise<void> {
  if (!db) return;
  try {
    await db.from("sessions_log").insert({
      room_id: roomId,
      client_code: room.clientCode,
      client_label: room.clientLabel ?? null,
      secure: room.secure,
      started_at: new Date(room.createdAt).toISOString(),
      ended_at: new Date().toISOString(),
      peer_count: room.peers.size,
    });
  } catch {}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function genRoomId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function notifyAdmin(data: object): void {
  if (adminWs?.readyState === WebSocket.OPEN) {
    adminWs.send(JSON.stringify(data));
  }
}

function destroyRoom(roomId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  clearTimeout(room.timer);
  for (const [, peer] of room.peers) {
    try { peer.ws.close(1001, "room_expired"); } catch {}
  }
  logSessionEnd(roomId, room); // best-effort audit log
  rooms.delete(roomId);
  notifyAdmin({ type: "session_ended", roomId });
}

function broadcast(roomId: string, data: string | Buffer, excludeId?: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const [id, peer] of room.peers) {
    if (id !== excludeId && peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(data);
    }
  }
}

const MAX_BODY_BYTES = 16 * 1024; // 16 KB — no legitimate request needs more

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer | string) => {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(String(c));
      size += buf.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();          // abort the connection immediately
        resolve({});            // treat as empty body → 401/403 downstream
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      try { resolve(text ? JSON.parse(text) : {}); }
      catch { resolve({}); }   // corps invalide → traité comme body vide (401 propre au lieu de 500)
    });
    req.on("error", reject);
  });
}

function sessionSnapshot() {
  return Array.from(rooms.entries()).map(([roomId, r]) => ({
    roomId,
    secure: r.secure,
    clientCode: r.clientCode,
    clientLabel: r.clientLabel,
    peers: r.peers.size,
    createdAt: r.createdAt,
  }));
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const httpServer = createServer((req, res) => {
  // Restrict CORS: admin routes only accept requests from the same origin.
  // Public endpoints (/client/join, static files) remain accessible cross-origin.
  const origin = req.headers.origin ?? "";
  const isAdminRoute = (req.url ?? "").startsWith("/admin");
  if (isAdminRoute) {
    // Allowlist: Railway domain + localhost dev
    const allowed = [
      "https://ghostmesh-production.up.railway.app",
      "http://localhost:5173",
      "http://localhost:3000",
    ];
    if (allowed.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    // No CORS header → browser blocks cross-origin admin requests
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  const authHeader = req.headers.authorization ?? "";
  const isAdmin = authHeader === `Bearer ${ADMIN_TOKEN}`;

  const json = (status: number, data: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  (async () => {
    // ── POST /admin/auth ──────────────────────────────────────────────────────
    if (req.method === "POST" && pathname === "/admin/auth") {
      // Rate limit: 10 attempts per minute per IP
      if (!rateAllow(`auth:${clientIp(req)}`, 10, 60_000)) {
        return json(429, { error: "too_many_requests" });
      }
      const body = await readBody(req) as { token?: string };
      if (body.token === ADMIN_TOKEN) return json(200, { ok: true });
      return json(401, { error: "unauthorized" });
    }

    // ── POST /admin/codes ─────────────────────────────────────────────────────
    if (req.method === "POST" && pathname === "/admin/codes") {
      if (!isAdmin) return json(401, { error: "unauthorized" });
      const body = await readBody(req) as { code?: string; label?: string };
      const code = String(body.code ?? "").trim();
      const label = String(body.label ?? "Contact").trim();
      if (!/^\d{8}$/.test(code)) return json(400, { error: "8 chiffres requis (JJMMAAAA)" });
      if (code === INSECURE_CODE.padStart(8, "0")) return json(400, { error: "code réservé" });
      const entry: ClientCode = { code, label, createdAt: Date.now() };
      clientCodes.set(code, entry);
      await persistCode(entry);
      return json(200, { ok: true, code, label });
    }

    // ── GET /admin/codes ──────────────────────────────────────────────────────
    if (req.method === "GET" && pathname === "/admin/codes") {
      if (!isAdmin) return json(401, { error: "unauthorized" });
      return json(200, { codes: Array.from(clientCodes.values()) });
    }

    // ── DELETE /admin/codes/:code ─────────────────────────────────────────────
    if (req.method === "DELETE" && pathname.startsWith("/admin/codes/")) {
      if (!isAdmin) return json(401, { error: "unauthorized" });
      const code = pathname.split("/").pop() ?? "";
      clientCodes.delete(code);
      await deleteCodeFromDb(code);
      return json(200, { ok: true });
    }

    // ── GET /admin/sessions ───────────────────────────────────────────────────
    if (req.method === "GET" && pathname === "/admin/sessions") {
      if (!isAdmin) return json(401, { error: "unauthorized" });
      return json(200, { sessions: sessionSnapshot() });
    }

    // ── POST /admin/end-session ───────────────────────────────────────────────
    if (req.method === "POST" && pathname === "/admin/end-session") {
      if (!isAdmin) return json(401, { error: "unauthorized" });
      const body = await readBody(req) as { roomId?: string };
      destroyRoom(String(body.roomId ?? ""));
      return json(200, { ok: true });
    }

    // ── POST /admin/register-device ───────────────────────────────────────────
    if (req.method === "POST" && pathname === "/admin/register-device") {
      if (!isAdmin) return json(401, { error: "unauthorized" });
      const body = await readBody(req) as { fcmToken?: string };
      const fcmToken = String(body.fcmToken ?? "").trim();
      if (!fcmToken) return json(400, { error: "fcmToken requis" });
      await saveFcmToken(fcmToken);
      console.log(`[FCM] Token enregistré: ${fcmToken.substring(0, 20)}... (total: ${fcmTokens.size})`);
      return json(200, { ok: true, registered: fcmTokens.size });
    }

    // ── POST /client/join ─────────────────────────────────────────────────────
    if (req.method === "POST" && pathname === "/client/join") {
      // Rate limit: 10 session creations per minute per IP
      if (!rateAllow(`join:${clientIp(req)}`, 10, 60_000)) {
        return json(429, { error: "too_many_requests" });
      }
      const body = await readBody(req) as { code?: string };
      const code = String(body.code ?? "").trim();

      let secure = false;
      let label: string | undefined;

      if (code === INSECURE_CODE) {
        secure = false;
      } else if (clientCodes.has(code)) {
        secure = true;
        label = clientCodes.get(code)!.label;
      } else {
        return json(403, { error: "code_invalide" });
      }

      const roomId = genRoomId();
      const timer = setTimeout(() => destroyRoom(roomId), TTL_MS);
      const createdAt = Date.now();
      rooms.set(roomId, { peers: new Map(), timer, secure, clientCode: code, clientLabel: label, createdAt, wsMode: false, wsPubkeySent: new Set() });

      notifyAdmin({ type: "client_waiting", roomId, code, secure, label, createdAt });
      sendFcmPush(
        "GhostMesh — Nouveau contact",
        `${label ?? code} initie une session${secure ? " sécurisée" : " insecure"}`
      );

      return json(200, { roomId, secure, label });
    }

    // Fichiers statiques (build Vite) — uniquement en production
    if (existsSync(STATIC_DIR) && serveStatic(res, pathname)) return;

    res.writeHead(404);
    res.end();
  })().catch((err) => {
    console.error("[GhostMesh] handler error:", err);
    if (!res.headersSent) { res.writeHead(500); res.end(); }
  });
});

// ─── WebSocket Server ─────────────────────────────────────────────────────────

// 64 KB max per WebSocket message — prevents memory exhaustion via oversized payloads.
// Signaling messages (SDP, ICE, encrypted chat) are always well under this limit.
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  // Admin notification channel
  if (pathname === "/admin-ws") {
    if (url.searchParams.get("token") !== ADMIN_TOKEN) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, "__ADMIN__");
    });
    return;
  }

  // Peer signaling channel
  const match = pathname.match(/^\/signal\/([a-f0-9]{16})$/);
  if (!match) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  const roomId = match[1];
  const room = rooms.get(roomId);

  // Use proper WebSocket close codes (4xxx = app-level) instead of raw HTTP
  // rejections so the client can distinguish the error type via onclose.
  if (!room) {
    wss.handleUpgrade(req, socket, head, (ws) => ws.close(4004, "room_not_found"));
    return;
  }

  if (room.peers.size >= 2) {
    wss.handleUpgrade(req, socket, head, (ws) => ws.close(4008, "room_full"));
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req, roomId);
  });
});

wss.on("connection", (ws: WebSocket, req: IncomingMessage, context: string) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  // ── Admin notification WS ─────────────────────────────────────────────────
  if (context === "__ADMIN__") {
    adminWs = ws;
    ws.send(JSON.stringify({ type: "admin_connected", insecureCode: INSECURE_CODE }));
    ws.send(JSON.stringify({ type: "sessions_list", sessions: sessionSnapshot() }));
    ws.send(JSON.stringify({ type: "codes_list", codes: Array.from(clientCodes.values()) }));

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.type === "end_session") destroyRoom(String(msg.roomId));
      } catch {}
    });

    ws.on("close", () => { if (adminWs === ws) adminWs = null; });
    return;
  }

  // ── Peer signaling WS ─────────────────────────────────────────────────────
  const roomId = context;
  const room = rooms.get(roomId);
  if (!room) { ws.close(1008, "room_not_found"); return; }
  if (room.peers.size >= 2) { ws.close(1008, "room_full"); return; }

  const peerId = crypto.randomUUID();
  // Validate admin role: only grant if the correct token is provided.
  // Prevents impersonation: any anonymous peer claiming role=admin is treated as client.
  const claimedRole = url.searchParams.get("role");
  const wsToken     = url.searchParams.get("token") ?? "";
  const role: "admin" | "client" =
    (claimedRole === "admin" && wsToken === ADMIN_TOKEN) ? "admin" : "client";

  room.peers.set(peerId, { ws, peerId, joinedAt: Date.now(), role });
  ws.send(JSON.stringify({ type: "assigned", peerId, roomId, secure: room.secure }));

  if (room.peers.size === 2) {
    // Send 'ready' ONLY to the first-connected peer so it becomes the WebRTC
    // initiator. Broadcasting to both causes a glare condition where both peers
    // simultaneously send offers and then ignore each other's — connection hangs.
    const [firstPeerId] = room.peers.keys();
    const firstPeer = room.peers.get(firstPeerId)!;
    if (firstPeer.ws.readyState === WebSocket.OPEN) {
      firstPeer.ws.send(JSON.stringify({ type: "ready", roomId }));
    }
  }

  ws.on("message", (data: Buffer | string, isBinary: boolean) => {
    if (isBinary) {
      broadcast(roomId, data as Buffer, peerId);
      return;
    }
    try {
      const parsed = JSON.parse(data.toString()) as Record<string, unknown>;

      // Ring → notify admin dashboard
      if (parsed.type === "ring") {
        notifyAdmin({
          type: "client_ring",
          roomId,
          code: room.clientCode,
          label: room.clientLabel,
        });
        broadcast(roomId, JSON.stringify({ type: "ring_ack" }), peerId);
        return;
      }

      // WS relay fallback: a peer signals that WebRTC/UDP is unavailable.
      // Switch the room to WS relay mode and notify ALL peers with their role.
      // Subsequent ws_pubkey / ws_msg / ws_bye messages flow through the
      // catch-all broadcast below — the server forwards ciphertext opaquely.
      if (parsed.type === "ws_start" && !room.wsMode) {
        room.wsMode = true;
        const peerIds = Array.from(room.peers.keys()); // insertion order = join order
        for (const [pid, peer] of room.peers) {
          if (peer.ws.readyState === WebSocket.OPEN) {
            peer.ws.send(JSON.stringify({
              type:        "ws_mode",
              isInitiator: pid === peerIds[0], // first-joined peer initiates ECDH
            }));
          }
        }
        return;
      }

      // ── ws_pubkey relay guard (fix: WS-4 MITM injection) ─────────────────
      // Only relay ws_pubkey when:
      //   1. The room is in WS relay mode (ws_start was triggered)
      //   2. This peer hasn't sent a ws_pubkey already (one key per peer per session)
      // This prevents a rogue peer from injecting a fake public key to MITM
      // the key exchange and impersonate the other party.
      if (parsed.type === "ws_pubkey") {
        if (!room.wsMode) return;                        // ignore outside relay mode
        if (room.wsPubkeySent.has(peerId)) return;       // already sent — reject duplicate
        room.wsPubkeySent.add(peerId);
      }

      // Generic relay (SDP, ICE, ws_pubkey, ws_msg, ws_bye, …)
      parsed._from = peerId;
      broadcast(roomId, JSON.stringify(parsed), peerId);
    } catch {}
  });

  ws.on("close", () => {
    const r = rooms.get(roomId);
    if (!r) return;
    r.peers.delete(peerId);
    broadcast(roomId, JSON.stringify({ type: "peer_left", peerId }), peerId);
    notifyAdmin({ type: "peer_left", roomId, role });
    if (r.peers.size === 0) destroyRoom(roomId);
  });

  ws.on("error", () => {
    const r = rooms.get(roomId);
    if (r) {
      r.peers.delete(peerId);
      if (r.peers.size === 0) destroyRoom(roomId);
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, "0.0.0.0", async () => {
  console.log(`\n⬡  GhostMesh Server — port ${PORT}`);
  console.log(`   Admin token  : ${ADMIN_TOKEN}`);
  console.log(`   Insecure code: ${INSECURE_CODE}`);
  console.log(`   Static dir   : ${STATIC_DIR} (${existsSync(STATIC_DIR) ? "✓" : "absent — dev mode"})`);
  console.log(`   Supabase     : ${db ? "✓ connecté" : "✗ non configuré"}\n`);
  await loadCodesFromDb();
});
