import {
  generateKeyPair,
  deriveSharedKey,
  buildFrame,
  parseFrame,
  encrypt,
  decrypt,
  deriveVerificationCode,
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
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

export class GhostConnection {
  private ws:          WebSocket | null = null;
  private pc:          RTCPeerConnection | null = null;
  private dc:          RTCDataChannel | null = null;
  private keyPair:     KeyPair | null = null;
  private secret:      SharedSecret | null = null;
  private isInitiator  = false;
  private _isSecure    = false;            // backing field — use getter
  private _closed      = false;            // set on close() to abort in-flight connect()
  private roomId:      string;
  private role:        "client" | "admin";
  private cb:          GhostConnectionCallbacks;

  /** Whether the session was flagged secure by the server. Read-only externally. */
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

  async connect(): Promise<void> {
    this.cb.onStatus("connecting");
    this.keyPair = await generateKeyPair();
    // Guard: close() may have been called while generateKeyPair() was awaiting
    // (React Strict Mode cleanup runs before the async continuation). Without
    // this check, the WebSocket would still open, leaving a ghost peer in the
    // room and causing a "room full" error when the real connection is made.
    if (this._closed) return;
    const roleParam = this.role === "admin" ? "?role=admin" : "";
    this.ws = new WebSocket(wsUrl(`/signal/${this.roomId}${roleParam}`));
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen  = () => this.cb.onStatus("signaling");

    this.ws.onerror = () => {
      // Only fires for network-level failures (server unreachable, proxy error).
      // App-level rejections (room not found, full) arrive via onclose instead.
      this.cb.onError("Serveur signaling inaccessible — vérifiez que le serveur est démarré");
      this.cb.onStatus("error");
    };

    this.ws.onclose = (ev) => {
      // App-level rejection codes set by the server
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
      // Normal close after DataChannel established (code 1000) — nothing to do.
      // Any other unexpected close during signaling → mark as error.
      if (this.dc?.readyState !== "open" && ev.code !== 1000 && !this.secret) {
        this.cb.onStatus("error");
      }
    };

    this.ws.onmessage = async (ev) => {
      if (ev.data instanceof ArrayBuffer) return;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(ev.data as string); } catch { return; }

      switch (msg.type) {
        case "assigned":
          this._isSecure = Boolean(msg.secure);
          this.cb.onSecure?.(this._isSecure);
          break;

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
            } catch (e) {
              this.cb.onError(`Offer handling failed: ${String(e)}`);
            }
          }
          break;

        case "answer":
          if (this.isInitiator) {
            try {
              await this.pc!.setRemoteDescription(
                new RTCSessionDescription({ type: "answer", sdp: msg.sdp as string })
              );
            } catch (e) {
              this.cb.onError(`Answer handling failed: ${String(e)}`);
            }
          }
          break;

        case "ice":
          try {
            await this.pc!.addIceCandidate(
              new RTCIceCandidate(msg.candidate as RTCIceCandidateInit)
            );
          } catch { /* ignore stale ICE candidates */ }
          break;

        case "ring_ack":
          this.cb.onRingAck?.();
          break;

        case "peer_left":
          this.close("peer_disconnected");
          break;
      }
    };
  }

  private async setupPeerConnection(): Promise<void> {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.wsSend({ type: "ice", candidate: candidate.toJSON() });
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc?.connectionState === "failed") {
        this.cb.onError("WebRTC connection failed");
        this.cb.onStatus("error");
      }
    };

    if (this.isInitiator) {
      this.dc = this.pc.createDataChannel("ghost", { ordered: true });
      this.setupDataChannel(this.dc);
    } else {
      this.pc.ondatachannel = (ev) => {
        this.dc = ev.channel;
        this.setupDataChannel(this.dc);
      };
    }
  }

  private setupDataChannel(dc: RTCDataChannel): void {
    dc.binaryType = "arraybuffer";

    dc.onopen = async () => {
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
        // Keep the signal WS open — it is still needed for ring() and for the
        // server to track peer presence. Closing it here would (1) silently
        // drop all future wsSend() calls (ring, bye-broadcast) and (2) trigger
        // the server's ws.on("close") handler which removes the peer from the
        // room and potentially destroys it, making the session vanish from the
        // admin dashboard. The WS is closed explicitly in close().
        return;
      }

      if (type === FRAME_MESSAGE && this.secret) {
        try {
          const text = await decrypt(this.secret, payload);
          this.cb.onMessage({ id: crypto.randomUUID(), text, self: false, ts: Date.now() });
        } catch {
          this.cb.onError("Décryption échouée — message ignoré");
        }
        return;
      }

      if (type === FRAME_BYE) {
        this.close("peer_said_bye");
      }
    };

    dc.onclose = () => {
      if (this.dc?.readyState !== "open") this.cb.onStatus("closed");
    };

    dc.onerror = () => {
      this.cb.onError("DataChannel error");
      this.cb.onStatus("error");
    };
  }

  private async createOffer(): Promise<void> {
    const offer = await this.pc!.createOffer();
    await this.pc!.setLocalDescription(offer);
    this.wsSend({ type: "offer", sdp: offer.sdp });
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.dc || this.dc.readyState !== "open" || !this.secret) return;
    const payload = await encrypt(this.secret, text);
    this.dc.send(buildFrame(FRAME_MESSAGE, payload));
    this.cb.onMessage({ id: crypto.randomUUID(), text, self: true, ts: Date.now() });
  }

  ring(): void {
    this.wsSend({ type: "ring" });
  }

  close(reason = "user_closed"): void {
    this._closed = true;
    if (this.dc?.readyState === "open") {
      try { this.dc.send(buildFrame(FRAME_BYE, new Uint8Array(0) as Uint8Array<ArrayBuffer>)); } catch {}
    }
    this.dc?.close();
    this.pc?.close();
    this.ws?.close(1000, reason);
    this.cb.onStatus("closed");
  }

  private wsSend(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}
