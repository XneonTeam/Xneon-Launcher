import { ArchiveContext, ParserError } from "./archive.js"

export interface ClassAnnotation { descriptor: string; visible: boolean; values: Record<string, unknown> }
export interface ClassInfo { name: string; superName?: string; interfaces: string[]; minorVersion: number; majorVersion: number; accessFlags: number; annotations: ClassAnnotation[] }
export interface ClassScanOptions { maxClassSize?: number; maxClasses?: number; maxAnnotationDepth?: number; maxAnnotationValues?: number }
export interface ClassScanResult { classes: ClassInfo[]; diagnostics: { path: string; message: string }[]; complete: boolean }

function invalid(message: string): never { throw new ParserError("INVALID_CLASS", message) }
class Reader {
  private readonly view: DataView
  constructor(private readonly bytes: Uint8Array, public pos = 0, readonly end = bytes.length) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) }
  private require(length: number) { if (!Number.isSafeInteger(length) || length < 0 || this.pos + length > this.end) invalid("Truncated class file") }
  u1(): number { this.require(1); return this.bytes[this.pos++] }
  u2(): number { this.require(2); const value = this.view.getUint16(this.pos); this.pos += 2; return value }
  u4(): number { this.require(4); const value = this.view.getUint32(this.pos); this.pos += 4; return value }
  skip(length: number): void { this.require(length); this.pos += length }
  slice(length: number): Uint8Array { this.require(length); const result = this.bytes.subarray(this.pos, this.pos + length); this.pos += length; return result }
}
type PoolEntry = { tag: number; offset: number }

// Class-файлы используют modified UTF-8: NUL кодируется как C0 80,
// а дополнительные символы представлены парой UTF-16 surrogate units.
function modifiedUtf8(bytes: Uint8Array): string {
  const units: number[] = []
  for (let i = 0; i < bytes.length;) {
    const a = bytes[i++]
    if (a >= 1 && a <= 0x7f) { units.push(a); continue }
    if (a >= 0xc0 && a <= 0xdf) {
      if (i >= bytes.length) invalid("Invalid modified UTF-8")
      const b = bytes[i++], code = ((a & 31) << 6) | (b & 63)
      if ((b & 0xc0) !== 0x80 || (code < 0x80 && code !== 0) || (code === 0 && a !== 0xc0)) invalid("Invalid modified UTF-8")
      units.push(code); continue
    }
    if (a >= 0xe0 && a <= 0xef) {
      if (i + 1 >= bytes.length) invalid("Invalid modified UTF-8")
      const b = bytes[i++], c = bytes[i++], code = ((a & 15) << 12) | ((b & 63) << 6) | (c & 63)
      if ((b & 0xc0) !== 0x80 || (c & 0xc0) !== 0x80 || code < 0x800) invalid("Invalid modified UTF-8")
      units.push(code); continue
    }
    invalid("Invalid modified UTF-8")
  }
  let result = ""
  for (let i = 0; i < units.length; i += 8192) result += String.fromCharCode(...units.slice(i, i + 8192))
  return result
}

export function parseClassFile(bytes: Uint8Array, options: ClassScanOptions = {}): ClassInfo {
  const maxClassSize = options.maxClassSize ?? 8 * 1024 * 1024
  const maxDepth = options.maxAnnotationDepth ?? 16, maxValues = options.maxAnnotationValues ?? 10000
  for (const limit of [maxClassSize, maxDepth, maxValues]) if (!Number.isSafeInteger(limit) || limit < 0) invalid("Invalid class limits")
  if (bytes.length > maxClassSize) throw new ParserError("LIMIT_EXCEEDED", "Class size limit exceeded")
  const reader = new Reader(bytes), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (reader.u4() !== 0xcafebabe) invalid("Invalid class magic")
  const minorVersion = reader.u2(), majorVersion = reader.u2(), count = reader.u2()
  if (!count) invalid("Invalid constant pool count")
  const pool: (PoolEntry | undefined)[] = new Array(count), strings = new Map<number, string>()
  for (let i = 1; i < count; i++) {
    const tag = reader.u1(), offset = reader.pos
    pool[i] = { tag, offset }
    switch (tag) {
      case 1: reader.skip(reader.u2()); break
      case 3: case 4: case 9: case 10: case 11: case 12: case 17: case 18: reader.skip(4); break
      case 5: case 6: reader.skip(8); if (++i >= count) invalid("Invalid double-slot constant"); break
      case 7: case 8: case 16: case 19: case 20: reader.skip(2); break
      case 15: reader.skip(3); break
      default: invalid(`Unsupported constant pool tag ${tag}`)
    }
  }
  function entry(index: number, tag: number): PoolEntry {
    const item = pool[index]
    if (!item || item.tag !== tag) invalid("Invalid constant pool reference")
    return item
  }
  function utf(index: number): string {
    const cached = strings.get(index)
    if (cached !== undefined) return cached
    const item = entry(index, 1), length = view.getUint16(item.offset)
    const value = modifiedUtf8(bytes.subarray(item.offset + 2, item.offset + 2 + length))
    strings.set(index, value)
    return value
  }
  function className(index: number): string { return utf(view.getUint16(entry(index, 7).offset)) }
  const accessFlags = reader.u2(), name = className(reader.u2()), superIndex = reader.u2(), interfaces: string[] = []
  const interfaceCount = reader.u2()
  for (let i = 0; i < interfaceCount; i++) interfaces.push(className(reader.u2()))
  function skipMembers() {
    const members = reader.u2()
    for (let i = 0; i < members; i++) {
      reader.u2(); utf(reader.u2()); utf(reader.u2())
      const attributes = reader.u2()
      for (let j = 0; j < attributes; j++) { utf(reader.u2()); reader.skip(reader.u4()) }
    }
  }
  skipMembers(); skipMembers()
  const annotations: ClassAnnotation[] = []
  let valuesRead = 0
  function consume(depth: number) { if (depth > maxDepth || ++valuesRead > maxValues) throw new ParserError("LIMIT_EXCEEDED", "Annotation limit exceeded") }
  function annotation(input: Reader, visible: boolean, depth: number): ClassAnnotation {
    consume(depth)
    const descriptor = utf(input.u2()), count = input.u2(), values: Record<string, unknown> = Object.create(null)
    for (let i = 0; i < count; i++) { const key = utf(input.u2()); if (Object.hasOwn(values, key)) invalid("Duplicate annotation element"); values[key] = value(input, visible, depth + 1) }
    return { descriptor, visible, values }
  }
  function value(input: Reader, visible: boolean, depth: number): unknown {
    consume(depth)
    const tag = String.fromCharCode(input.u1())
    if (tag === "s" || tag === "c") return utf(input.u2())
    if (tag === "e") return { type: utf(input.u2()), name: utf(input.u2()) }
    if (tag === "@") return annotation(input, visible, depth + 1)
    if (tag === "[") { const size = input.u2(), items: unknown[] = []; for (let i = 0; i < size; i++) items.push(value(input, visible, depth + 1)); return items }
    const index = input.u2()
    if ("BCISZ".includes(tag)) { const n = view.getInt32(entry(index, 3).offset); return tag === "Z" ? n !== 0 : n }
    if (tag === "F") return view.getFloat32(entry(index, 4).offset)
    if (tag === "J") return view.getBigInt64(entry(index, 5).offset)
    if (tag === "D") return view.getFloat64(entry(index, 6).offset)
    return invalid("Unsupported annotation value")
  }
  const attributes = reader.u2()
  for (let i = 0; i < attributes; i++) {
    const name = utf(reader.u2()), length = reader.u4(), data = reader.slice(length)
    if (name !== "RuntimeVisibleAnnotations" && name !== "RuntimeInvisibleAnnotations") continue
    const input = new Reader(data), count = input.u2(), visible = name === "RuntimeVisibleAnnotations"
    for (let j = 0; j < count; j++) annotations.push(annotation(input, visible, 0))
    if (input.pos !== input.end) invalid("Invalid annotation attribute length")
  }
  if (reader.pos !== reader.end) invalid("Trailing class file data")
  return { name, superName: superIndex ? className(superIndex) : undefined, interfaces, minorVersion, majorVersion, accessFlags, annotations }
}

export function forgeModAnnotations(info: ClassInfo): ClassAnnotation[] {
  return info.annotations.filter(annotation => annotation.descriptor === "Lnet/minecraftforge/fml/common/Mod;" || annotation.descriptor === "Lcpw/mods/fml/common/Mod;")
}

export async function scanArchiveClasses(archive: ArchiveContext, options: ClassScanOptions = {}): Promise<ClassScanResult> {
  const maxClasses = options.maxClasses ?? 10000, maxClassSize = options.maxClassSize ?? 8 * 1024 * 1024
  if (!Number.isSafeInteger(maxClasses) || maxClasses < 0) invalid("Invalid class count limit")
  const entries = archive.entries().filter(entry => entry.name.endsWith(".class") && !entry.name.endsWith("/"))
  const classes: ClassInfo[] = [], diagnostics: { path: string; message: string }[] = []
  for (const entry of entries.slice(0, maxClasses)) {
    try { classes.push(parseClassFile(await archive.read(entry.name, maxClassSize), options)) }
    catch (error) {
      if (error instanceof ParserError && (error.code === "ABORTED" || error.code === "CLOSED")) throw error
      diagnostics.push({ path: entry.name, message: error instanceof Error ? error.message : "Invalid class" })
    }
  }
  return { classes, diagnostics, complete: entries.length <= maxClasses && diagnostics.length === 0 }
}
