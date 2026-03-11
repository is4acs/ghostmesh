import {
  generateKeyPair,
  deriveSharedKey,
  buildFrame,
  parseFrame,
  encrypt,
  decrypt,
  deriveVerificationCode,
  toBase64,
  fromBase64,
  FRAME_PUBKEY,
  FRAME_MESSAGE,
  FRAME_BYE,
  type KeyPair,
  type SharedSecret,
} from "../crypto/CryptoEngine";
import { wsUrl } from "../theme";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "signaling"
  | "handshaking"
  | "secure"
  | "closed"
  | "error";

export interface GhostMessage {
  id:   string;
  text: string;
  self: boolean;
  ts:   number;
}

export interface VerificationCode {
  emojis: string;
  hex:    string;
}

export interface GhostConnectionCallbacks {
  onStatus:       (s: ConnectionStatus) => void;
  onMessage:      (m: GhostMessage) => void;
  onVerification: (code: VerificationCode) => void;
  onError:        (msg: string) => void;
  onSecure?:      (secure: boolean) => void;
  onRingAck?:     () => void;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302"  },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

// If WebRTC ICE doesn't establish within this window, trigger WS relay fallback.
// 10 s covers most real networks; on GrapheneOS (UDP blocked) ICE fails instantly
// so oniceconnectionstatechange = "failed" will fire well before the timer.
const WS_FALLBACK_TIMEOUT_MS = 10_000;

export class GhostConnection {
  // ── WebRTC state ──────────────────────────────────────────────────────────
  private ws:          WebSocket | null = null;
  private pc:          RTCPeerConnection | null = null;
  private dc:          RTCDataChannel | null = null;
  private keyPair:     KeyPair | null = null;
  private secret:      SharedSecret | null = null;
  private isInitiator  = false;
  private _isSecure    = false;
  private _closed      = false;

  // ── WS relay fallback (GrapheneOS / strict-NAT / no UDP) ─────────────────
  // All messages remain AES-256-GCM encrypted end-to-end.
  // The server only ever forwards opaque ciphertext — it never sees plaintext.
  private _wsMode      = false;
  private _wsInitiator = false;
  private _iceTimer:   ReturnType<typeof setTimeout> | null = null;

  private roomId: string;
  private role:   "client" | "admin";
  private cb:     GhostConnectionCallbacks;

  get isSecure(): boolean { return this._isSecure; }

  constructor(
    roomId: string,
    callbacks: GhostConnectionCallbacks,
    role: "client" | "admin" = "client"
  ) {
    this.roomId = roomId;
    this.cb     = callbacks;
    this.role   = role;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.cb.onStatus("connecting");
    this.keyPair = await generateKeyPair();
    // Guard: close() may have been called while generateKeyPair() was awaiting
    // (React Strict Mode cleanup fires before the async continuation).
    if (this._closed) return;

    const roleParam = this.role === "admin" ? "?role=admin" : "";
    this.ws = new WebSocket(wsUrl(`/signal/${this.roomId}${roleParam}`));
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen  = () => this.cb.onStatus("signaling");
    this.ws.onerror = () => {
      this.cb.onError("Serveur signaling inaccessible — vérifiez que le serveur est démarré");
      this.cb.onStatus("error");
    };
    this.ws.onclose = (ev) => {
      if (ev.code === 4004) {
        this.cb.onError("Session introuvable — le code est expiré ou le serveur a redémarré");
        this.cb.onStatus("error");
        return;
      }
      if (ev.code === 4008) {
        this.cb.onError("Session complète — 2 participants déjà connectés");
        this.cb.onStatus("error");
        return;
      }
      const established = this._wsMode ? !!this.secret : this.dc?.readyState === "open";
      if (!established && ev.code !== 1000 && !this.secret) this.cb.onStatus("error");
    };
    this.ws.onmessage = async (ev) => {
      if (ev.data instanceof ArrayBuffer) return;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(ev.data as string); } catch { return; }
      await this.handleServerMessage(msg);
    };
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.secret) return;
    if (this._wsMode) {
      // WS relay: ciphertext is opaque to the server
      const cipher = await encrypt(this.secret, text);
      this.wsSend({ type: "ws_msg", data: toBase64(cipher) });
      this.cb.onMessage({ id: crypto.randomUUID(), text, self: true, ts: Date.now() });
      return;
    }
    if (!this.dc || this.dc.readyState !== "open") return;
    const payload = await encrypt(this.secret, text);
    this.dc.send(buildFrame(FRAME_MESSAGE, payload));
    this.cb.onMessage({ id: crypto.randomUUID(), text, self: true, ts: Date.now() });
  }

  ring(): void {
    // Works in both modes — always routed through the signaling WS
    this.wsSend({ type: "ring" });
  }

  close(reason = "user_closed"): void {
    this._closed = true;
    this._clearIceTimer();
    if (this._wsMode) {
      this.wsSend({ type: "ws_bye" }); // server relays via catch-all
    } else if (this.dc?.readyState === "open") {
      try { this.dc.send(buildFrame(FRAME_BYE, new Uint8Array(0) as Uint8Array<ArrayBuffer>)); } catch {}
    }
    this.dc?.close();
    this.pc?.close();
    this.ws?.close(1000, reason);
    this.cb.onStatus("closed");
  }

  // ── Message router ─────────────────────────────────────────────────────────

  private async handleServerMessage(msg: Record<string, unknown>): Promise<void> {
    switch (msg.type) {

      // ── Session metadata ─────────────────────────────────────────────────
      case "assigned":
        this._isSecure = Boolean(msg.secure);
        this.cb.onSecure?.(this._isSecure);
        break;

      // ── WebRTC signaling ─────────────────────────────────────────────────
      case "ready":
        if (!this.pc) {
          this.isInitiator = true;
          await this.setupPeerConnection();
          await this.createOffer();
        }
        break;

      case "offer":
        if (!this.isInitiator) {
          if (!this.pc) await this.setupPeerConnection();
          try {
            await this.pc!.setRemoteDescription(
              new RTCSessionDescription({ type: "offer", sdp: msg.sdp as string })
            );
            const answer = await this.pc!.createAnswer();
            await this.pc!.setLocalDescription(answer);
            this.wsSend({ type: "answer", sdp: answer.sdp });
          } catch (e) { this.cb.onError(`Offer failed: ${String(e)}`); }
        }
        break;

      case "answer":
        if (this.isInitiator) {
          try {
            await this.pc!.setRemoteDescription(
              new RTCSessionDescription({ type: "answer", sdp: msg.sdp as string })
            );
          } catch (e) { this.cb.onError(`Answer failed: ${String(e)}`); }
        }
        break;

      case "ice":
        try {
          await this.pc!.addIceCandidate(
            new RTCIceCandidate(msg.candidate as RTCIceCandidateInit)
          );
        } catch { /* stale candidate */ }
        break;

      // ── WS relay fallback ─────────────────────────────────────────────────
      //
      // Triggered automatically when:
      //   • ICE state = "failed" (immediate on Vanadium — UDP blocked)
      //   • ICE connection state = "failed"
      //   • WS_FALLBACK_TIMEOUT_MS passes with no DataChannel open
      //
      // Key exchange mirrors the WebRTC path (ECDH P-256 via WS messages).
      // All subsequent messages are AES-256-GCM encrypted before transmission.

      case "ws_mode": {
        this._wsMode      = true;
        this._wsInitiator = Boolean(msg.isInitiator);
        this._clearIceTimer();
        this.pc?.close(); this.pc = null;
        this.dc?.close(); this.dc = null;
        this.cb.onStatus("handshaking");
        // Initiator starts the ECDH exchange
        if (this._wsInitiator && this.keyPair) {
          this.wsSend({ type: "ws_pubkey", data: toBase64(this.keyPair.publicKeyRaw) });
        }
        break;
      }

      case "ws_pubkey": {
        if (!this.keyPair) break;
        const peerRaw = fromBase64(msg.data as string);
        this.secret   = await deriveSharedKey(this.keyPair.privateKey, peerRaw);
        const code    = await deriveVerificationCode(this.keyPair.publicKeyRaw, peerRaw);
        this.cb.onVerification(code);
        // Responder echoes its public key so initiator can also derive
        if (!this._wsInitiator) {
          this.wsSend({ type: "ws_pubkey", data: toBase64(this.keyPair.publicKeyRaw) });
        }
        this._isSecure = true;
        this.cb.onStatus("secure");
        break;
      }

      case "ws_msg": {
        if (!this.secret) break;
        try {
          const cipher = fromBase64(msg.data as string);
          const text   = await decrypt(this.secret, cipher);
          this.cb.onMessage({ id: crypto.randomUUID(), text, self: false, ts: Date.now() });
        } catch { this.cb.onError("Décryption échouée — message ignoré"); }
        break;
      }

      case "ws_bye":
        this.close("peer_said_bye");
        break;

      // ── Session events ────────────────────────────────────────────────────
      case "ring_ack":
        this.cb.onRingAck?.();
        break;

      case "peer_left":
        this.close("peer_disconnected");
        break;
    }
  }

  // ── WebRTC internals ───────────────────────────────────────────────────────

  private async setupPeerConnection(): Promise<void> {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.wsSend({ type: "ice", candidate: candidate.toJSON() });
    };

    // Instant fallback on explicit ICE failure (Vanadium UDP-blocked scenario)
    this.pc.oniceconnectionstatechange = () => {
      if (this.pc?.iceConnectionState === "failed" && !this._wsMode && !this._closed) {
        this._triggerWsFallback();
      }
    };
    this.pc.onconnectionstatechange = () => {
      if (this.pc?.connectionState === "failed" && !this._wsMode && !this._closed) {
        this._triggerWsFallback();
      }
    };

    // Safety-net: cancel if DataChannel didn't open in time
    this._iceTimer = setTimeout(() => {
      if (this._closed || this._wsMode || this.dc?.readyState === "open") return;
      this._triggerWsFallback();
    }, WS_FALLBACK_TIMEOUT_MS);

    if (this.isInitiator) {
      this.dc = this.pc.createDataChannel("ghost", { ordered: true });
      this.setupDataChannel(this.dc);
    } else {
      this.pc.ondatachannel = (ev) => { this.dc = ev.channel; this.setupDataChannel(this.dc); };
    }
  }

  private _triggerWsFallback(): void {
    if (this._wsMode || this._closed) return;
    // Tell server to switch all peers in this room to WS relay mode.
    // Server responds with ws_mode (isInitiator) to all peers.
    this.wsSend({ type: "ws_start" });
  }

  private _clearIceTimer(): void {
    if (this._iceTimer) { clearTimeout(this._iceTimer); this._iceTimer = null; }
  }

  private setupDataChannel(dc: RTCDataChannel): void {
    dc.binaryType = "arraybuffer";
    dc.onopen = () => {
      this._clearIceTimer(); // WebRTC succeeded — cancel fallback timer
      this.cb.onStatus("handshaking");
      dc.send(buildFrame(FRAME_PUBKEY, this.keyPair!.publicKeyRaw));
    };
    dc.onmessage = async (ev) => {
      const data = new Uint8Array(ev.data as ArrayBuffer) as Uint8Array<ArrayBuffer>;
      const { type, payload } = parseFrame(data);
      if (type === FRAME_PUBKEY) {
        this.secret = await deriveSharedKey(this.keyPair!.privateKey, payload);
        const code  = await deriveVerificationCode(this.keyPair!.publicKeyRaw, payload);
        this.cb.onVerification(code);
        this.cb.onStatus("secure");
        return;
      }
      if (type === FRAME_MESSAGE && this.secret) {
        try {
          const text = await decrypt(this.secret, payload);
          this.cb.onMessage({ id: crypto.randomUUID(), text, self: false, ts: Date.now() });
        } catch { this.cb.onError("Décryption échouée"); }
        return;
      }
      if (type === FRAME_BYE) this.close("peer_said_bye");
    };
    dc.onclose = () => { if (!this._wsMode && this.dc?.readyState !== "open") this.cb.onStatus("closed"); };
    dc.onerror = () => { this.cb.onError("DataChannel error"); this.cb.onStatus("error"); };
  }

  private async createOffer(): Promise<void> {
    const offer = await this.pc!.createOffer();
    await this.pc!.setLocalDescription(offer);
    this.wsSend({ type: "offer", sdp: offer.sdp });
  }

  private wsSend(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data));
  }
}
