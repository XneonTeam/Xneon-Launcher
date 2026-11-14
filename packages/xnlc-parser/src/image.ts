import { ParserError } from "./archive.js"

/** Проверка структуры контейнера без декодирования пикселей. */
export function probeImage(bytes: Uint8Array): { mimeType: string; width: number; height: number; frames: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const bad = (): never => { throw new ParserError("CORRUPTED_ARCHIVE", "Invalid or unsupported image container") }
  const limits = (w: number, h: number, frames = 1) => {
    if (w < 1 || h < 1 || w > 4096 || h > 4096 || w * h * frames > 16_777_216 || frames > 64) throw new ParserError("LIMIT_EXCEEDED", "Image dimensions or frame budget exceeded")
  }
  const tag = (p: number, s: string) => Array.from(s).every((c, i) => bytes[p + i] === c.charCodeAt(0))
  const result = (mimeType: string, width: number, height: number, frames = 1) => { limits(width, height, frames); return { mimeType, width, height, frames } }
  if ([137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b)) {
    if (bytes.length < 45 || v.getUint32(8) !== 13 || !tag(12, "IHDR")) return bad()
    const w = v.getUint32(16), h = v.getUint32(20)
    limits(w,h)
    let data = false
    for (let p = 8; p + 12 <= bytes.length;) {
      const n = v.getUint32(p), end = p + 12 + n
      if (end > bytes.length || Bun.hash.crc32(bytes.subarray(p+4,end-4)) !== v.getUint32(end-4)) return bad()
      if (tag(p+4,"acTL") || tag(p+4,"fcTL") || tag(p+4,"fdAT")) return bad()
      if (tag(p+4,"IDAT") && n) data = true
      if (tag(p+4,"IEND")) return data && n === 0 && end === bytes.length ? result("image/png",w,h) : bad()
      p = end
    }
  } else if (tag(0,"GIF87a") || tag(0,"GIF89a")) {
    if (bytes.length < 14) return bad()
    const w = v.getUint16(6,true), h = v.getUint16(8,true)
    limits(w,h)
    let p = 13 + (bytes[10] & 128 ? 3 << ((bytes[10] & 7)+1) : 0), frames = 0
    const blocks = () => { while (p < bytes.length) { const n = bytes[p++]; if (!n) return; p += n } bad() }
    while (p < bytes.length) {
      const marker = bytes[p++]
      if (marker === 0x3b) return frames && p === bytes.length ? result("image/gif",w,h,frames) : bad()
      if (marker === 0x21) { p++; blocks(); continue }
      if (marker !== 0x2c || p + 9 > bytes.length) return bad()
      const fw = v.getUint16(p+4,true), fh = v.getUint16(p+6,true)
      if (!fw || !fh || v.getUint16(p,true)+fw > w || v.getUint16(p+2,true)+fh > h) return bad()
      const flags = bytes[p+8]
      p += 9 + (flags & 128 ? 3 << ((flags & 7)+1) : 0)
      if (bytes[p] < 2 || bytes[p] > 8 || p >= bytes.length) return bad()
      p++; blocks(); limits(w,h,++frames)
    }
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    let w = 0, h = 0, scan = false
    for (let p = 2; p < bytes.length;) {
      if (bytes[p++] !== 255) { if (scan) continue; return bad() }
      while (bytes[p] === 255) p++
      const m = bytes[p++]
      if (scan && (m === 0 || m >= 0xd0 && m <= 0xd7)) continue
      if (m === 0xd9) return scan && p === bytes.length ? result("image/jpeg",w,h) : bad()
      if (p+2 > bytes.length) return bad()
      const n = v.getUint16(p)
      if (n < 2 || p+n > bytes.length) return bad()
      if ([0xc0,0xc1,0xc2].includes(m)) {
        if (n < 8 || w || scan) return bad()
        h = v.getUint16(p+3); w = v.getUint16(p+5); limits(w,h)
      }
      if (m === 0xda) { if (!w || n < 6) return bad(); scan = true }
      p += n
    }
  } else if (bytes.length >= 20 && tag(0,"RIFF") && tag(8,"WEBP")) {
    if (v.getUint32(4,true)+8 !== bytes.length) return bad()
    let w = 0, h = 0, canvasW = 0, canvasH = 0, p = 12
    for (; p+8 <= bytes.length;) {
      const n = v.getUint32(p+4,true), q = p+8, end = q+n+(n&1)
      if (end > bytes.length || tag(p,"ANIM") || tag(p,"ANMF")) return bad()
      if (tag(p,"VP8X")) {
        if (p !== 12 || n !== 10 || bytes[q]&2) return bad()
        canvasW = 1+bytes[q+4]+256*bytes[q+5]+65536*bytes[q+6]
        canvasH = 1+bytes[q+7]+256*bytes[q+8]+65536*bytes[q+9]; limits(canvasW,canvasH)
      } else if (tag(p,"VP8L")) {
        if (w || n < 6 || bytes[q] !== 0x2f || bytes[q+4] & 0xe0) return bad()
        const bits = v.getUint32(q+1,true); w = 1+(bits&16383); h = 1+((bits>>>14)&16383)
      } else if (tag(p,"VP8 ")) {
        if (w || n < 11 || bytes[q]&1 || bytes[q+3] !== 157 || bytes[q+4] !== 1 || bytes[q+5] !== 42) return bad()
        w = v.getUint16(q+6,true)&16383; h = v.getUint16(q+8,true)&16383
      }
      p = end
    }
    if (p === bytes.length && w && h && (!canvasW || canvasW === w && canvasH === h)) return result("image/webp",w,h)
  }
  return bad()
}
