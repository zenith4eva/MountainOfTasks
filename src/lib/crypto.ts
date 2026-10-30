const enc = new TextEncoder()
const dec = new TextDecoder()

export const ITERATIONS = 600_000
export const MAX_FAILS = 5

export interface Sealed { salt: string; iv: string; ct: string }

export const b64 = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b)
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function pinKey(pin: string, salt: Uint8Array, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

async function seal(key: CryptoKey, salt: Uint8Array, secret: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(secret))
  return { salt: b64(salt), iv: b64(iv), ct: b64(ct) }
}

/** Throws on a wrong key (AES-GCM auth tag fails). */
async function open(key: CryptoKey, s: Sealed): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(s.iv) as BufferSource }, key, unb64(s.ct) as BufferSource)
  return dec.decode(pt)
}

export async function sealWithPin(pin: string, secret: string, iterations = ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return seal(await pinKey(pin, salt, iterations), salt, secret)
}

export async function openWithPin(pin: string, s: Sealed, iterations = ITERATIONS) {
  return open(await pinKey(pin, unb64(s.salt), iterations), s)
}

// --- Biometric: WebAuthn platform passkey + PRF extension -> HKDF -> AES-GCM ---

async function prfKey(prf: ArrayBuffer, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', prf, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: enc.encode('mountain-of-tasks pat') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

export interface BioSealed extends Sealed { credId: string; prfSalt: string }

export async function bioSupported() {
  return !!window.PublicKeyCredential &&
    (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false))
}

async function prfEval(credId: Uint8Array, prfSalt: Uint8Array): Promise<ArrayBuffer> {
  const a = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: credId as BufferSource }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: prfSalt as BufferSource } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null
  const r = (a?.getClientExtensionResults() as any)?.prf?.results?.first
  if (!r) throw new Error('This authenticator does not support the PRF extension')
  return r
}

export async function enrollBiometric(secret: string): Promise<BioSealed> {
  const prfSalt = crypto.getRandomValues(new Uint8Array(32))
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Mountain of Tasks' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'mountain', displayName: 'Mountain of Tasks' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('Passkey creation cancelled')
  if (!(cred.getClientExtensionResults() as any)?.prf?.enabled) throw new Error('This device does not support passkey PRF')
  const credId = new Uint8Array(cred.rawId)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const sealed = await seal(await prfKey(await prfEval(credId, prfSalt), salt), salt, secret)
  return { ...sealed, credId: b64(credId), prfSalt: b64(prfSalt) }
}

export async function openWithBiometric(s: BioSealed) {
  const prf = await prfEval(unb64(s.credId), unb64(s.prfSalt))
  return open(await prfKey(prf, unb64(s.salt)), s)
}

// --- hashing ---

export async function sha256Hex(data: ArrayBuffer | Uint8Array) {
  const h = await crypto.subtle.digest('SHA-256', data as BufferSource)
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** Git blob object id, so we can tell whether a remote file changed without fetching it. */
export async function gitBlobSha(data: Uint8Array) {
  const head = enc.encode(`blob ${data.length}\0`)
  const all = new Uint8Array(head.length + data.length)
  all.set(head)
  all.set(data, head.length)
  const h = await crypto.subtle.digest('SHA-1', all)
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
