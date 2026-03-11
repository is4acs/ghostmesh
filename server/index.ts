import { createServer, IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { URL } from "url";
import { readFileSync, existsSync, statSync } from "fs";
import { join, extname, dirname } from "path";
import { fileURLToPath } from "url";

const PORT = Number(process.env.PORT ?? 3000);

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
};

function serveStatic(res: import("http").ServerResponse, pathname: string): boolean {
  // Essaye le chemin exact, puis index.html (SPA fallback)
  const candidates = [
    join(STATIC_DIR, pathname),
    join(STATIC_DIR, pathname, "index.html"),
  ];
  for (const fp of candidates) {
    if (existsSync(fp) && statSync(fp).isFile()) {
      const mime = MIME[extname(fp)] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime });
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
  wsMode:       boolean; // true when WebRTC failed → peers use WS relay
}

// ─── State ────────────────────────────────────────────────────────────────────

const clientCodes = new Map<string, ClientCode>();
const rooms = new Map<string, Room>();
let adminWs: WebSocket | null = null;

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

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer | string) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))));
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
  res.setHeader("Access-Control-Allow-Origin", "*");
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
      const body = await readBody(req) as { token?: string };
      if (body.token === ADMIN_TOKEN) return json(200, { ok: true });
      return json(401, { error: "unauthorized" });
    }

    // ── POST /admin/codes ─────────────────────────────────────────────────────
    if (req.method === "POST" && pathname === "/admin/codes") {
      if (!isAdmin) return json(401, { error: "unauthorized" });
      const body = await readBody(req) as { code?: string; label?: string };
      const code = String(body.code ?? "").trim();
      const label = String(body.label ?? "Client").trim();
      if (!/^\d{8}$/.test(code)) return json(400, { error: "8 chiffres requis (JJMMAAAA)" });
      if (code === INSECURE_CODE.padStart(8, "0")) return json(400, { error: "code réservé" });
      clientCodes.set(code, { code, label, createdAt: Date.now() });
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

    // ── POST /client/join ─────────────────────────────────────────────────────
    if (req.method === "POST" && pathname === "/client/join") {
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
      rooms.set(roomId, { peers: new Map(), timer, secure, clientCode: code, clientLabel: label, createdAt, wsMode: false });

      notifyAdmin({ type: "client_waiting", roomId, code, secure, label, createdAt });

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

const wss = new WebSocketServer({ noServer: true });

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
  const role = url.searchParams.get("role") === "admin" ? "admin" : "client";

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

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`\n⬡  GhostMesh Server — port ${PORT}`);
  console.log(`   Admin token  : ${ADMIN_TOKEN}`);
  console.log(`   Insecure code: ${INSECURE_CODE}`);
  console.log(`   Static dir   : ${STATIC_DIR} (${existsSync(STATIC_DIR) ? "✓" : "absent — dev mode"})\n`);
});
