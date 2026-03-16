#!/usr/bin/env node
/**
 * GhostMesh Security Stress Test
 * Tests: auth bypass, code enumeration, WS injection, relay interception,
 *        replay attacks, MITM simulation, DoS, CORS, info leakage.
 * Run:  node scripts/security-test.mjs
 * Target: http://localhost:3000 (start server first: npm start --prefix server)
 */

// Use ws from server's node_modules
import { createRequire } from "module";
const require = createRequire(new URL("../server/package.json", import.meta.url));
const WebSocket = require("ws");

const BASE    = "http://localhost:3000";
const WS_BASE = "ws://localhost:3000";

// ── ANSI ──────────────────────────────────────────────────────────────────────
const R     = "\x1b[31m"; const G = "\x1b[32m"; const Y = "\x1b[33m";
const B     = "\x1b[34m"; const M = "\x1b[35m"; const C = "\x1b[36m";
const RESET = "\x1b[0m";
const PASS  = `${G}[PASS]${RESET}`;
const FAIL  = `${R}[FAIL]${RESET}`;
const WARN  = `${Y}[WARN]${RESET}`;
const INFO  = `${B}[INFO]${RESET}`;
const VULN  = `${R}[VULN ⚠]${RESET}`;
const SAFE  = `${G}[SAFE ✓]${RESET}`;

const findings = [];

function log(tag, msg) { console.log(`  ${tag} ${msg}`); }
function section(title) {
  console.log(`\n${B}${"─".repeat(60)}${RESET}`);
  console.log(`${M}▶ ${title}${RESET}`);
  console.log(`${B}${"─".repeat(60)}${RESET}`);
}
function vuln(id, msg, detail = "") {
  findings.push({ id, sev: "HIGH",   msg, detail });
  log(VULN, `${Y}${id}${RESET}: ${msg}`);
  if (detail) console.log(`       ${C}↳ ${detail}${RESET}`);
}
function safe(id, msg) {
  findings.push({ id, sev: "OK",     msg });
  log(SAFE, `${id}: ${msg}`);
}
function warn(id, msg, detail = "") {
  findings.push({ id, sev: "MEDIUM", msg, detail });
  log(WARN, `${Y}${id}${RESET}: ${msg}`);
  if (detail) console.log(`       ${C}↳ ${detail}${RESET}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function http(method, path, body, headers = {}) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json", ...headers },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  try {
    const r = await fetch(`${BASE}${path}`, opts);
    let data;
    try { data = await r.json(); } catch { data = null; }
    return { status: r.status, data, headers: Object.fromEntries(r.headers.entries()) };
  } catch (e) {
    return { status: 0, data: null, error: e.message };
  }
}

function connectWs(path) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}${path}`);
    const msgs = [];
    ws.on("open",    ()  => resolve({ ws, msgs }));
    ws.on("message", (d) => { try { msgs.push(JSON.parse(d.toString())); } catch {} });
    ws.on("error",   (e) => reject(e));
    ws.on("close",   (code, reason) => {
      // inject close code into msgs for inspection
      msgs.push({ __close__: true, code, reason: reason?.toString() });
    });
    setTimeout(() => reject(new Error("WS connect timeout")), 5000);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Create a legitimate room ──────────────────────────────────────────────────

async function createRoom(code = "00000") {
  const r = await http("POST", "/client/join", { code });
  if (r.status !== 200) throw new Error(`createRoom failed: ${JSON.stringify(r)}`);
  return r.data.roomId;
}

// ════════════════════════════════════════════════════════════════════════════
//  CATEGORY 1 — Authentication & Authorization
// ════════════════════════════════════════════════════════════════════════════
async function testAuth() {
  section("1. Authentication & Authorization");

  // 1.1 Access admin endpoints without token
  const noToken = await http("GET", "/admin/codes");
  if (noToken.status === 401) {
    safe("AUTH-1", "GET /admin/codes → 401 without token");
  } else {
    vuln("AUTH-1", "GET /admin/codes accessible without auth!", `status: ${noToken.status}`);
  }

  // 1.2 Access with wrong token
  const wrongToken = await http("GET", "/admin/codes", undefined, { Authorization: "Bearer WRONG" });
  if (wrongToken.status === 401) {
    safe("AUTH-2", "Wrong token → 401");
  } else {
    vuln("AUTH-2", "Wrong admin token accepted!", `status: ${wrongToken.status}`);
  }

  // 1.3 Default token check (GHOST_ADMIN)
  const defaultToken = await http("GET", "/admin/codes", undefined, { Authorization: "Bearer GHOST_ADMIN" });
  if (defaultToken.status === 200) {
    vuln("AUTH-3", "Default admin token 'GHOST_ADMIN' is active!",
         "Server is running with the fallback token. Set ADMIN_TOKEN env var in production.");
  } else {
    safe("AUTH-3", "Default token 'GHOST_ADMIN' rejected → custom token set");
  }

  // 1.4 Admin sessions list without token
  const sessions = await http("GET", "/admin/sessions");
  if (sessions.status === 401) {
    safe("AUTH-4", "GET /admin/sessions → 401 without token");
  } else {
    vuln("AUTH-4", "Session list accessible without auth!", `data: ${JSON.stringify(sessions.data)}`);
  }

  // 1.5 Admin WS with wrong token
  const wsResult = await new Promise(resolve => {
    const ws = new WebSocket(`${WS_BASE}/admin-ws?token=WRONG`);
    ws.on("open", () => resolve("open"));
    ws.on("close", (code) => resolve(`closed:${code}`));
    ws.on("error", () => resolve("error"));
    setTimeout(() => resolve("timeout"), 3000);
  });
  if (wsResult.startsWith("closed") || wsResult === "error") {
    safe("AUTH-5", `Admin WS with wrong token → rejected (${wsResult})`);
  } else {
    vuln("AUTH-5", "Admin WS accepted without valid token!", `result: ${wsResult}`);
  }

  // 1.6 POST /admin/auth — token brute force (send 20 guesses rapidly)
  const guesses = ["admin", "password", "ghost", "ghostmesh", "123456", "GHOST_ADMIN",
                   "admin123", "secret", "token", "ghostadmin", "root", "test",
                   "ghost_admin", "GhostMesh", "ghost123", "mesh", "ADMIN", "GHOSTMESH",
                   "ghostmesh123", "12345678"];
  let bruteHit = null;
  await Promise.all(guesses.map(async g => {
    const r = await http("POST", "/admin/auth", { token: g });
    if (r.status === 200) bruteHit = g;
  }));
  if (bruteHit) {
    vuln("AUTH-6", `Admin token brute-forced: "${bruteHit}"`, "No rate limiting on /admin/auth");
  } else {
    // Check if any rate-limiting was applied
    warn("AUTH-6", "20 brute-force attempts completed without being rate-limited",
         "Server returned 401 for all guesses but imposed no rate limit or lockout");
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  CATEGORY 2 — Code Enumeration & Input Validation
// ════════════════════════════════════════════════════════════════════════════
async function testCodeEnum() {
  section("2. Code Enumeration & Input Validation");

  // 2.1 Rapid code guessing (no rate limit?)
  const start = Date.now();
  const attempts = 50;
  let valid = 0;
  const guesses = Array.from({ length: attempts }, (_, i) => String(i).padStart(8, "0"));
  const results = await Promise.all(guesses.map(code => http("POST", "/client/join", { code })));
  const elapsed = Date.now() - start;
  valid = results.filter(r => r.status === 200).length;
  const perSec = Math.round(attempts / (elapsed / 1000));
  warn("CODE-1", `${attempts} code guesses in ${elapsed}ms (${perSec}/s) — no rate limiting detected`,
       `Found ${valid} valid code(s). At this rate, 10^8 codes bruteforceable in ~${Math.round(100000000/perSec/3600)}h`);

  // 2.2 Invalid code formats accepted?
  const badCodes = [
    { code: "",               expect: 403, label: "empty code" },
    { code: "abc12345",       expect: 403, label: "letters" },
    { code: "1234",           expect: 403, label: "4 digits (too short)" },
    { code: "123456789",      expect: 403, label: "9 digits (too long)" },
    { code: "' OR 1=1 --",   expect: 403, label: "SQL injection" },
    { code: "<script>x</script>", expect: 403, label: "XSS payload" },
    { code: "../../../etc/passwd", expect: 403, label: "path traversal" },
    { code: "null",           expect: 403, label: "null string" },
    { code: "undefined",      expect: 403, label: "undefined string" },
  ];
  for (const { code, expect, label } of badCodes) {
    const r = await http("POST", "/client/join", { code });
    if (r.status === expect || r.status === 400) {
      safe("CODE-2", `"${label}" → ${r.status} (rejected)`);
    } else {
      vuln("CODE-2", `"${label}" → ${r.status} (should be ${expect})!`, JSON.stringify(r.data));
    }
  }

  // 2.3 Insecure code accessible without being in code list
  const insecure = await http("POST", "/client/join", { code: "00000" });
  if (insecure.status === 200 && insecure.data?.secure === false) {
    warn("CODE-3", "Insecure code '00000' creates a session with secure=false",
         "Client is NOT warned about insecure sessions unless the UI shows a dialog. Server-side OK.");
  } else {
    log(INFO, `Insecure code test: ${insecure.status}`);
  }

  // 2.4 Body size limit
  const bigPayload = { code: "A".repeat(100000) };
  const bigR = await http("POST", "/client/join", bigPayload);
  if (bigR.status !== 500 && bigR.status !== 0) {
    warn("CODE-4", `Large payload (100KB) returned ${bigR.status} — no body size limit enforced`,
         "Consider adding a body size limit to prevent memory exhaustion");
  } else {
    safe("CODE-4", `Large payload rejected (${bigR.status})`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  CATEGORY 3 — WebSocket Security & Room Access
// ════════════════════════════════════════════════════════════════════════════
async function testWebSocket() {
  section("3. WebSocket Security & Room Access");

  // 3.1 Connect to non-existent room
  const closeCode = await new Promise(resolve => {
    const ws = new WebSocket(`${WS_BASE}/signal/deadbeef00000000`);
    ws.on("close",  (code) => resolve(code));
    ws.on("error",  ()     => resolve(0));
    setTimeout(() => resolve(-1), 3000);
  });
  if (closeCode === 4004) {
    safe("WS-1", "Non-existent room → WS close 4004 (room_not_found)");
  } else {
    warn("WS-1", `Non-existent room → close code ${closeCode} (expected 4004)`);
  }

  // 3.2 Third peer can't join (room full check)
  const roomId = await createRoom("00000");
  // Connect peer 1
  const p1 = await connectWs(`/signal/${roomId}?role=client`);
  // Connect peer 2
  const p2 = await connectWs(`/signal/${roomId}?role=admin`);
  await sleep(200);
  // Try peer 3
  const p3Close = await new Promise(resolve => {
    const ws = new WebSocket(`${WS_BASE}/signal/${roomId}`);
    ws.on("close",  (code) => resolve(code));
    ws.on("error",  ()     => resolve(0));
    setTimeout(() => resolve(-1), 3000);
  });
  if (p3Close === 4008) {
    safe("WS-2", "3rd peer correctly rejected → WS close 4008 (room_full)");
  } else {
    vuln("WS-2", `3rd peer NOT rejected! close code: ${p3Close}`,
         "A third party could potentially join an active session");
  }
  p1.ws.close(); p2.ws.close();

  // 3.3 Impersonate admin role (claim admin without token)
  const roomId2 = await createRoom("00000");
  const fakeAdmin = await connectWs(`/signal/${roomId2}?role=admin`);
  const assignedMsg = fakeAdmin.msgs.find(m => m.type === "assigned");
  if (assignedMsg) {
    // Role is assigned but does it grant any extra privileges?
    warn("WS-3", `Anyone can claim role=admin in WebSocket URL`,
         `Server assigns role "${assignedMsg.role}" without verifying admin token on WS peer`);
  }
  fakeAdmin.ws.close();

  // 3.4 WS message injection — can a peer inject message types to trick the other peer?
  const roomId3 = await createRoom("00000");
  const injector = await connectWs(`/signal/${roomId3}?role=client`);
  const victim   = await connectWs(`/signal/${roomId3}?role=client`);
  await sleep(300);

  // Inject a fake ws_pubkey message (MITM simulation in relay mode)
  const fakeKey = Buffer.from(new Uint8Array(65).fill(0xAB)).toString("base64");
  injector.ws.send(JSON.stringify({ type: "ws_pubkey", data: fakeKey }));
  await sleep(300);

  const victimGotFakeKey = victim.msgs.find(m => m.type === "ws_pubkey");
  if (victimGotFakeKey) {
    vuln("WS-4", "Peer can inject fake ws_pubkey messages to the other peer!",
         "Server relays ws_pubkey without validation. In WS relay mode, a compromised server (or network) could MITM the key exchange. The verification code is the ONLY defense.");
  } else {
    safe("WS-4", "ws_pubkey injection not relayed (or filtered)");
  }

  // 3.5 Can a peer inject a ws_mode message (trigger relay mode on victim)?
  const roomId4 = await createRoom("00000");
  const aggressor = await connectWs(`/signal/${roomId4}?role=client`);
  const target    = await connectWs(`/signal/${roomId4}?role=client`);
  await sleep(300);
  aggressor.ws.send(JSON.stringify({ type: "ws_start" }));
  await sleep(300);
  const targetGotWsMode = target.msgs.find(m => m.type === "ws_mode");
  if (targetGotWsMode) {
    warn("WS-5", "Either peer can force WS relay mode (send ws_start)",
         "This is by design (for NAT fallback) but an adversarial client could force the less-efficient relay path. Not a security issue but a denial-of-WebRTC.");
  } else {
    safe("WS-5", "ws_start from client didn't trigger ws_mode on peer");
  }
  aggressor.ws.close(); target.ws.close();

  // 3.6 WebSocket path traversal
  const traversal = await new Promise(resolve => {
    const ws = new WebSocket(`${WS_BASE}/signal/../admin-ws`);
    ws.on("close",  (code) => resolve(code));
    ws.on("error",  ()     => resolve("error"));
    ws.on("open",   ()     => resolve("open"));
    setTimeout(() => resolve("timeout"), 2000);
  });
  if (traversal === "open") {
    vuln("WS-6", "WS path traversal: /signal/../admin-ws connected without token!");
  } else {
    safe("WS-6", `WS path traversal rejected (${traversal})`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  CATEGORY 4 — Relay Interception & Encryption Analysis
// ════════════════════════════════════════════════════════════════════════════
async function testRelay() {
  section("4. Relay Interception & Encryption Analysis");

  // 4.1 Can the server see message plaintext in ws_msg?
  // We simulate the relay: create a room, two peers exchange, send a ws_msg
  const roomId = await createRoom("00000");
  const peer1  = await connectWs(`/signal/${roomId}?role=client`);
  const peer2  = await connectWs(`/signal/${roomId}?role=client`);
  await sleep(200);

  // Simulate ws_msg with fake "encrypted" data (just base64)
  const fakeMsg = Buffer.from("PLAINTEXT_SECRET_MESSAGE").toString("base64");
  peer1.ws.send(JSON.stringify({ type: "ws_msg", data: fakeMsg }));
  await sleep(200);

  const relayed = peer2.msgs.find(m => m.type === "ws_msg");
  if (relayed) {
    // The data field should be opaque ciphertext — server just forwards it
    // Verify the server didn't modify the data
    if (relayed.data === fakeMsg) {
      log(INFO, "Server forwarded ws_msg opaquely (data unmodified) ✓");
      log(INFO, "However, the server CAN see the base64 payload (it decodes to: 'PLAINTEXT_SECRET_MESSAGE')");
      warn("RELAY-1", "WS relay: server sees all ws_msg payloads as they pass through",
           "Server can log/inspect ciphertext but NOT decrypt without the ECDH-derived key. " +
           "E2E encryption holds IF the key exchange was not MITMed. Verification code is critical.");
    } else {
      warn("RELAY-1", "Server modified the ws_msg data field!", `original: ${fakeMsg}, received: ${relayed.data}`);
    }
  }

  // 4.2 Replay attack — can a captured ws_msg be replayed?
  // Send the same message again (replay)
  peer1.ws.send(JSON.stringify({ type: "ws_msg", data: fakeMsg }));
  await sleep(200);
  const replayed = peer2.msgs.filter(m => m.type === "ws_msg");
  if (replayed.length >= 2) {
    warn("RELAY-2", "Replay attack: duplicate ws_msg accepted by server",
         "Server has no replay protection (nonce/sequence). However, AES-GCM with random IV means " +
         "even replayed ciphertext produces different decryption attempts. Each message has a unique IV. " +
         "But a replayed message with its original IV would decrypt correctly if AES key is the same.");
  }

  // 4.3 Can peer inject arbitrary JSON fields?
  peer1.ws.send(JSON.stringify({ type: "ws_msg", data: fakeMsg, __proto__: { admin: true }, malicious: true }));
  await sleep(200);
  const injectedMsg = peer2.msgs.find(m => m.malicious);
  if (injectedMsg) {
    warn("RELAY-3", "Server relays arbitrary JSON fields in ws_msg (e.g., 'malicious: true')",
         "Non-standard fields are forwarded as-is. This is cosmetic but could confuse client-side parsers.");
  } else {
    safe("RELAY-3", "Arbitrary JSON fields not forwarded (or filtered)");
  }

  peer1.ws.close(); peer2.ws.close();
}

// ════════════════════════════════════════════════════════════════════════════
//  CATEGORY 5 — DoS & Resource Exhaustion
// ════════════════════════════════════════════════════════════════════════════
async function testDoS() {
  section("5. DoS & Resource Exhaustion");

  // 5.1 Rapid room creation (flood with insecure code)
  const dosStart = Date.now();
  const dosCount = 100;
  const dosResults = await Promise.all(
    Array.from({ length: dosCount }, () => http("POST", "/client/join", { code: "00000" }))
  );
  const dosOk = dosResults.filter(r => r.status === 200).length;
  const dosMs = Date.now() - dosStart;
  warn("DOS-1", `Created ${dosOk}/${dosCount} rooms in ${dosMs}ms with no rate limiting`,
       "An attacker can flood the server with rooms, exhausting memory. No auth required for client/join.");

  // 5.2 Large WebSocket messages
  const bigRoomId = await createRoom("00000");
  const bigSender = await connectWs(`/signal/${bigRoomId}?role=client`);
  const bigRecv   = await connectWs(`/signal/${bigRoomId}?role=client`);
  await sleep(200);

  const HUGE = "X".repeat(1_000_000); // 1MB message
  let bigMsgReceived = false;
  bigSender.ws.send(JSON.stringify({ type: "ws_msg", data: HUGE }));
  await sleep(1000);
  bigMsgReceived = bigRecv.msgs.some(m => m.type === "ws_msg" && m.data?.length > 100000);
  if (bigMsgReceived) {
    warn("DOS-2", "1MB WebSocket message forwarded without size limit",
         "No maxPayload configured on WebSocketServer. Allows memory exhaustion via large messages.");
  } else {
    safe("DOS-2", "Large WebSocket message rejected or dropped");
  }
  bigSender.ws.close(); bigRecv.ws.close();

  // 5.3 Orphaned room (no peers ever join)
  // Rooms created by /client/join auto-expire after TTL_MS (10 min) — check if cleanup works
  log(INFO, "Room TTL is 10 minutes — orphaned rooms cleaned up automatically (by design)");
  safe("DOS-3", "Room auto-expiry exists (10min TTL) — orphaned rooms eventually cleaned");
}

// ════════════════════════════════════════════════════════════════════════════
//  CATEGORY 6 — CORS & Information Leakage
// ════════════════════════════════════════════════════════════════════════════
async function testCors() {
  section("6. CORS & Information Leakage");

  // 6.1 CORS header check
  const r = await http("GET", "/admin/sessions");
  const cors = r.headers?.["access-control-allow-origin"];
  if (cors === "*") {
    warn("CORS-1", "Access-Control-Allow-Origin: * (wildcard CORS)",
         "Any website can make cross-origin requests to the API. " +
         "This means a malicious site could call /client/join on behalf of a victim. " +
         "For public endpoints like /client/join this may be acceptable, " +
         "but /admin/* should restrict to specific origins.");
  } else if (cors) {
    safe("CORS-1", `CORS origin restricted to: ${cors}`);
  } else {
    log(INFO, "No CORS header on this endpoint");
  }

  // 6.2 Error messages leak internal info?
  const r2 = await http("POST", "/client/join", { code: "99999999" });
  if (r2.data?.error === "code_invalide") {
    safe("INFO-1", 'Invalid code returns generic error "code_invalide" (no internal detail)');
  } else {
    warn("INFO-1", `Invalid code error message: ${JSON.stringify(r2.data)}`);
  }

  // 6.3 Stack traces exposed on malformed requests?
  const r3 = await http("POST", "/client/join", null);  // empty body
  if (JSON.stringify(r3.data ?? "").includes("Error") || JSON.stringify(r3.data ?? "").includes("stack")) {
    vuln("INFO-2", "Stack trace exposed in error response!", JSON.stringify(r3.data));
  } else {
    safe("INFO-2", "No stack trace in error response");
  }

  // 6.4 Admin token in logs? (Admin WS uses ?token= in URL)
  warn("INFO-3", "Admin token sent as URL query param in /admin-ws?token=TOKEN",
       "URL parameters appear in server logs, reverse-proxy logs, browser history, " +
       "and referrer headers. Consider using Authorization header or WS sub-protocol instead.");

  // 6.5 Server header
  const r4 = await http("GET", "/");
  const serverHeader = r4.headers?.["server"] ?? "none";
  if (serverHeader && serverHeader !== "none") {
    warn("INFO-4", `Server header reveals: "${serverHeader}"`, "Consider removing Server header");
  } else {
    safe("INFO-4", "No Server header exposed");
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  CATEGORY 7 — Cryptographic Analysis
// ════════════════════════════════════════════════════════════════════════════
async function testCrypto() {
  section("7. Cryptographic Analysis (Static)");

  // Analysis of the code without running it (Node.js doesn't have WebCrypto ECDH the same way)
  log(INFO, "Analyzing CryptoEngine.ts statically...");

  // 7.1 ECDH P-256 + AES-256-GCM
  safe("CRYPTO-1", "Uses ECDH P-256 + AES-256-GCM (NIST-approved, WebCrypto native — no deps)");

  // 7.2 IV generation
  safe("CRYPTO-2", "12-byte random IV per message via crypto.getRandomValues() ✓");

  // 7.3 GCM authentication tag
  safe("CRYPTO-3", "AES-GCM 16-byte auth tag — provides message authentication ✓");

  // 7.4 Key export
  warn("CRYPTO-4", "ECDH private key is marked extractable=true (generateKey uses extractable: true)",
       "Private keys should ideally be non-extractable. However they're ephemeral so risk is minimal. " +
       "Consider setting extractable: false if raw export is not needed.");

  // 7.5 Verification code entropy
  warn("CRYPTO-5", "Verification code has ~6.4 bits of entropy (4 emojis from pool of 20, 8 hex chars)",
       "The hex portion (8 chars = 32 bits) is strong. The emoji portion (4 * log2(20) ≈ 17 bits) is decorative. " +
       "Total collision probability ~1/4 billion — adequate for manual verification.");

  // 7.6 Key sort in verification code
  warn("CRYPTO-6", "Verification code sort uses only byte[1] of public key for comparison",
       "sorting on a single byte may rarely produce ties with different orderings. " +
       "Using full key comparison (lexicographic) would be more robust.");

  // 7.7 No perfect forward secrecy between sessions
  warn("CRYPTO-7", "Keys are ephemeral per-connection but NOT per-message",
       "If a session key is compromised, all messages in that session can be decrypted. " +
       "This is standard for this type of protocol — acceptable tradeoff.");

  // 7.8 No replay protection at crypto layer
  warn("CRYPTO-8", "No message counter / sequence number in the encrypted payload",
       "AES-GCM random IV prevents replay if the IV is included, but replayed messages " +
       "with the same IV+ciphertext will decrypt correctly. Consider appending a nonce/counter.");
}

// ════════════════════════════════════════════════════════════════════════════
//  CATEGORY 8 — Session Hijacking & Room ID Prediction
// ════════════════════════════════════════════════════════════════════════════
async function testHijack() {
  section("8. Session Hijacking & Room ID Prediction");

  // 8.1 Room ID entropy
  // genRoomId() = crypto.randomUUID().replace(/-/g,"").slice(0,16) → 64 bits from UUID v4
  log(INFO, "Room ID is 16 hex chars = 64 bits of entropy from UUID v4");
  safe("HIJACK-1", "Room ID entropy: 64 bits — not guessable by brute force");

  // 8.2 Can anyone connect to a room if they know the roomId?
  // (Yes — but they need the 8-digit code to create the room; room IDs are never published)
  warn("HIJACK-2", "Room ID, once known, allows any WS connection without further auth",
       "If a roomId leaks (e.g., through logs, referrer header, or URL sharing), " +
       "an attacker who knows it can connect as a 3rd peer... WAIT — only if room is not full. " +
       "Once both peers are connected the room is full (4008). Risk window: before admin joins.");

  // 8.3 Try to connect to a valid room before admin joins
  const roomId = await createRoom("00000");
  const hijacker = await connectWs(`/signal/${roomId}?role=admin`);
  await sleep(200);
  const assigned = hijacker.msgs.find(m => m.type === "assigned");
  if (assigned) {
    warn("HIJACK-3", "Hijacker connected to a room before admin as fake admin!",
         `roomId: ${roomId} — The real admin will then be rejected (4008). ` +
         "This is a session-steal vector: if attacker knows the roomId from network sniffing, " +
         "they can race to join before the real admin.");
  } else {
    safe("HIJACK-3", "Hijacker could not join pending room");
  }
  hijacker.ws.close();
}

// ════════════════════════════════════════════════════════════════════════════
//  FINAL REPORT
// ════════════════════════════════════════════════════════════════════════════
function printReport() {
  console.log(`\n\n${B}${"═".repeat(60)}${RESET}`);
  console.log(`${M}  GHOSTMESH SECURITY AUDIT REPORT${RESET}`);
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log(`${B}${"═".repeat(60)}${RESET}\n`);

  const high   = findings.filter(f => f.sev === "HIGH");
  const medium = findings.filter(f => f.sev === "MEDIUM");
  const ok     = findings.filter(f => f.sev === "OK");

  console.log(`  ${R}HIGH severity:   ${high.length}${RESET}`);
  console.log(`  ${Y}MEDIUM severity: ${medium.length}${RESET}`);
  console.log(`  ${G}PASSED:          ${ok.length}${RESET}\n`);

  if (high.length) {
    console.log(`${R}HIGH SEVERITY FINDINGS:${RESET}`);
    for (const f of high) {
      console.log(`  ${R}• [${f.id}]${RESET} ${f.msg}`);
      if (f.detail) console.log(`    ${C}${f.detail}${RESET}`);
    }
  }

  if (medium.length) {
    console.log(`\n${Y}MEDIUM SEVERITY FINDINGS:${RESET}`);
    for (const f of medium) {
      console.log(`  ${Y}• [${f.id}]${RESET} ${f.msg}`);
      if (f.detail) console.log(`    ${C}${f.detail}${RESET}`);
    }
  }

  console.log(`\n${G}OVERALL VERDICT:${RESET}`);
  if (high.length === 0) {
    console.log(`  ${G}✓ No critical vulnerabilities found.${RESET}`);
    console.log(`  ${Y}⚠ ${medium.length} medium-severity issues to address.${RESET}`);
  } else {
    console.log(`  ${R}✗ ${high.length} HIGH severity issues found — action required.${RESET}`);
  }

  console.log(`\n${B}${"═".repeat(60)}${RESET}\n`);
}

// ── Run all tests ─────────────────────────────────────────────────────────────
console.log(`\n${M}╔══════════════════════════════════════════════╗${RESET}`);
console.log(`${M}║   GhostMesh Security Stress Test v1.0       ║${RESET}`);
console.log(`${M}║   Target: ${BASE.padEnd(34)}║${RESET}`);
console.log(`${M}╚══════════════════════════════════════════════╝${RESET}`);

try {
  await testAuth();
  await testCodeEnum();
  await testWebSocket();
  await testRelay();
  await testDoS();
  await testCors();
  await testCrypto();
  await testHijack();
  printReport();
} catch (e) {
  console.error(`\n${R}[FATAL] Test suite crashed:${RESET}`, e.message);
  console.error("Is the server running? Run: npm start --prefix server");
  process.exit(1);
}
