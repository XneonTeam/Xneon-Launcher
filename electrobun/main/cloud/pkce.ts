import crypto from "crypto"

export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString("base64url")
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url")
  return { verifier, challenge }
}
