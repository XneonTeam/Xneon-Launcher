import { createPublicKey, verify, type KeyObject } from "node:crypto"

/** Общая граница доверия: JSON читается только после проверки подписи исходных bytes. */
export function authenticateUpdateDocument(bytes: Buffer, signature: Buffer, publicKey: KeyObject): Record<string, any> {
  if (bytes.length > 64 * 1024 || signature.length !== 64 || publicKey.type !== "public" ||
      publicKey.asymmetricKeyType !== "ed25519" || !verify(null, bytes, publicKey, signature)) {
    throw new Error("Invalid update manifest signature")
  }
  const document = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("Invalid update manifest document")
  return document
}

export function readUpdateSignature(envelopeBytes: Buffer, trustedKeys: Readonly<Record<string, string>>) {
  if (envelopeBytes.length > 1024) throw new Error("Update signature envelope is oversized")
  const envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(envelopeBytes))
  if (!envelope || typeof envelope.keyId !== "string" || !Object.hasOwn(trustedKeys, envelope.keyId) ||
      typeof envelope.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) {
    throw new Error("Unknown update signing key or invalid signature envelope")
  }
  return { signature: Buffer.from(envelope.signature, "base64"), publicKey: createPublicKey(trustedKeys[envelope.keyId]) }
}
