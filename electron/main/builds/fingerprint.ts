import fs from "fs/promises"

// CurseForge file fingerprints are 32-bit hashes of the file content
// with all whitespace characters stripped (matching XMCL's fingerprint
// implementation: murmurhash v2, seed 1).

function isWhitespaceCharacter(b: number): boolean {
  return b === 9 || b === 10 || b === 13 || b === 32
}

/** MurmurHash2 x86 32-bit over a byte array (same output as the `murmurhash` package's `v2`). */
export function murmurhash2(str: Uint8Array, seed: number): number {
  let l = str.length
  let h = seed ^ l
  let i = 0
  let k: number

  while (l >= 4) {
    k =
      ((str[i] & 0xff)) |
      ((str[i + 1] & 0xff) << 8) |
      ((str[i + 2] & 0xff) << 16) |
      ((str[i + 3] & 0xff) << 24)

    k = (((k & 0xffff) * 0x5bd1e995) + ((((k >>> 16) * 0x5bd1e995) & 0xffff) << 16))
    k ^= k >>> 24
    k = (((k & 0xffff) * 0x5bd1e995) + ((((k >>> 16) * 0x5bd1e995) & 0xffff) << 16))

    h = (((h & 0xffff) * 0x5bd1e995) + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16)) ^ k

    l -= 4
    i += 4
  }

  switch (l) {
    case 3: h ^= (str[i + 2] & 0xff) << 16
    // falls through
    case 2: h ^= (str[i + 1] & 0xff) << 8
    // falls through
    case 1:
      h ^= (str[i] & 0xff)
      h = (((h & 0xffff) * 0x5bd1e995) + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16))
  }

  h ^= h >>> 13
  h = (((h & 0xffff) * 0x5bd1e995) + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16))
  h ^= h >>> 15

  return h >>> 0
}

/** Computes the CurseForge fingerprint for a file (content with whitespace stripped, murmurhash v2 seed 1). */
export async function computeFingerprint(filePath: string): Promise<number> {
  const buf = await fs.readFile(filePath)
  let j = 0
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]
    if (!isWhitespaceCharacter(b)) {
      buf[j] = b
      j++
    }
  }
  return murmurhash2(buf.subarray(0, j), 1)
}