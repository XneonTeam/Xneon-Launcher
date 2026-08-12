import { TagType, NBTValue, NBTCompound, NBTList } from "./types.js"
import * as zlib from "node:zlib"

export interface ReadOptions {
  compressed?: boolean | "gzip" | "deflate"
}

export class NBTReader {
  private buffer: Buffer
  private offset: number = 0

  constructor(buffer: Buffer) {
    this.buffer = buffer
  }

  public read(options: ReadOptions = {}): NBTCompound {
    const { compressed } = options

    if (compressed === "gzip" || compressed === true) {
      this.buffer = zlib.gunzipSync(this.buffer)
    } else if (compressed === "deflate") {
      this.buffer = zlib.inflateSync(this.buffer)
    }

    const tagType = this.readByte()
    if (tagType !== TagType.TAG_Compound) {
      throw new Error(`Root tag must be TAG_Compound, got ${tagType}`)
    }

    this.readName()
    return this.readCompound() as NBTCompound
  }

  private readByte(): number {
    const value = this.buffer.readUInt8(this.offset)
    this.offset += 1
    return value
  }

  private readShort(): number {
    const value = this.buffer.readInt16BE(this.offset)
    this.offset += 2
    return value
  }

  private readInt(): number {
    const value = this.buffer.readInt32BE(this.offset)
    this.offset += 4
    return value
  }

  private readLong(): bigint {
    const high = this.buffer.readInt32BE(this.offset)
    const low = this.buffer.readUInt32BE(this.offset + 4)
    this.offset += 8
    return BigInt(high) * 0x100000000n + BigInt(low)
  }

  private readFloat(): number {
    const value = this.buffer.readFloatBE(this.offset)
    this.offset += 4
    return value
  }

  private readDouble(): number {
    const value = this.buffer.readDoubleBE(this.offset)
    this.offset += 8
    return value
  }

  private readName(): string {
    const length = this.buffer.readUInt16BE(this.offset)
    this.offset += 2
    if (length === 0) {
      return ""
    }
    const name = this.buffer.toString("utf-8", this.offset, this.offset + length)
    this.offset += length
    return name
  }

  private readString(): string {
    const length = this.buffer.readUInt16BE(this.offset)
    this.offset += 2
    if (length === 0) {
      return ""
    }
    const str = this.buffer.toString("utf-8", this.offset, this.offset + length)
    this.offset += length
    return str
  }

  private readByteArray(): number[] {
    const length = this.readInt()
    const arr: number[] = []
    for (let i = 0; i < length; i++) {
      arr.push(this.readByte())
    }
    return arr
  }

  private readIntArray(): number[] {
    const length = this.readInt()
    const arr: number[] = []
    for (let i = 0; i < length; i++) {
      arr.push(this.readInt())
    }
    return arr
  }

  private readLongArray(): bigint[] {
    const length = this.readInt()
    const arr: bigint[] = []
    for (let i = 0; i < length; i++) {
      arr.push(this.readLong())
    }
    return arr
  }

  private readList(): NBTList {
    const type = this.readByte() as TagType
    const count = this.readInt()

    const values: NBTValue[] = []
    for (let i = 0; i < count; i++) {
      values.push(this.readTag(type))
    }

    return { type, values }
  }

  private readCompound(): { [key: string]: NBTValue } {
    const compound: { [key: string]: NBTValue } = {}

    while (true) {
      const tagType = this.readByte() as TagType

      if (tagType === TagType.TAG_End) {
        break
      }

      const name = this.readName()
      const value = this.readTag(tagType)
      compound[name] = value
    }

    return compound
  }

  private readTag(type: TagType): NBTValue {
    switch (type) {
      case TagType.TAG_Byte:
        return this.readByte()
      case TagType.TAG_Short:
        return this.readShort()
      case TagType.TAG_Int:
        return this.readInt()
      case TagType.TAG_Long:
        return this.readLong()
      case TagType.TAG_Float:
        return this.readFloat()
      case TagType.TAG_Double:
        return this.readDouble()
      case TagType.TAG_Byte_Array:
        return this.readByteArray()
      case TagType.TAG_String:
        return this.readString()
      case TagType.TAG_List:
        return this.readList()
      case TagType.TAG_Compound:
        return this.readCompound()
      case TagType.TAG_Int_Array:
        return this.readIntArray()
      case TagType.TAG_Long_Array:
        return this.readLongArray()
      default:
        throw new Error(`Unknown tag type: ${type}`)
    }
  }
}