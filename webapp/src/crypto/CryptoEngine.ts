// ECDH P-256 + AES-256-GCM via Web Crypto API (native, zero deps)

export interface KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyRaw: Uint8Array<ArrayBuffer>; // uncompressed 65 bytes
}

export interface SharedSecret {
  encryptKey: CryptoKey;
}

// Frame types
export const FRAME_PUBKEY  = 0x01;
export const FRAME_MESSAGE = 0x02;
export const FRAME_BYE     = 0x03;

export async function generateKeyPair(): Promise<KeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );
  const rawPub = await crypto.subtle.exportKey("raw", pair.publicKey);
  return {
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    publicKeyRaw: new Uint8Array(rawPub as ArrayBuffer),
  };
}

export async function deriveSharedKey(
  privateKey: CryptoKey,
  peerPublicKeyRaw: Uint8Array<ArrayBuffer>
): Promise<SharedSecret> {
  const peerPub = await crypto.subtle.importKey(
    "raw",
    peerPublicKeyRaw,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const encryptKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: peerPub },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  return { encryptKey };
}

export async function encrypt(
  secret: SharedSecret,
  plaintext: string
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    secret.encryptKey,
    encoded
  );
  // Layout: [12 bytes IV][ciphertext + 16 bytes tag]
  const out = new Uint8Array(12 + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher as ArrayBuffer), 12);
  return out as Uint8Array<ArrayBuffer>;
}

export async function decrypt(
  secret: SharedSecret,
  data: Uint8Array<ArrayBuffer>
): Promise<string> {
  const iv = data.slice(0, 12);
  const cipher = data.slice(12);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    secret.encryptKey,
    cipher
  );
  return new TextDecoder().decode(plain);
}

// ─── Base64 helpers (WS relay transport — no external deps) ──────────────────

export function toBase64(arr: Uint8Array): string {
  let b = "";
  for (let i = 0; i < arr.length; i++) b += String.fromCharCode(arr[i]);
  return btoa(b);
}

export function fromBase64(str: string): Uint8Array<ArrayBuffer> {
  const raw = atob(str);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out as Uint8Array<ArrayBuffer>;
}

// Build a binary frame: [1 byte type][payload]
export function buildFrame(type: number, payload: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(1 + payload.length);
  frame[0] = type;
  frame.set(payload, 1);
  return frame as Uint8Array<ArrayBuffer>;
}

export function parseFrame(data: Uint8Array<ArrayBuffer>): { type: number; payload: Uint8Array<ArrayBuffer> } {
  return { type: data[0], payload: data.slice(1) as Uint8Array<ArrayBuffer> };
}

// Derive a short verification code from both public keys
export async function deriveVerificationCode(
  myPubRaw: Uint8Array<ArrayBuffer>,
  peerPubRaw: Uint8Array<ArrayBuffer>
): Promise<{ emojis: string; hex: string }> {
  const combined = new Uint8Array(myPubRaw.length + peerPubRaw.length);
  // Sort so both peers get the same code regardless of order
  const [a, b] = myPubRaw[1] < peerPubRaw[1]
    ? [myPubRaw, peerPubRaw]
    : [peerPubRaw, myPubRaw];
  combined.set(a, 0);
  combined.set(b, a.length);
  const digest = await crypto.subtle.digest("SHA-256", combined as Uint8Array<ArrayBuffer>);
  const bytes = new Uint8Array(digest as ArrayBuffer);
  const EMOJI_POOL = ["🔥","🌙","⚡","🦊","🎯","🌊","🧊","🌿","🔮","🦋",
                       "🎲","🐉","🌸","🚀","🎸","🦁","🌀","🍀","🌈","🎭"];
  const emojis = Array.from({ length: 4 }, (_, i) => EMOJI_POOL[bytes[i] % EMOJI_POOL.length]).join(" ");
  const hex = Array.from(bytes.slice(0, 4)).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return { emojis, hex };
}
