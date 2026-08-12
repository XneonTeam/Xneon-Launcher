import { TagType, NBTValue, NBTCompound, NBTList } from "./types.js"
import * as zlib from "node:zlib"

export interface WriteOptions {
  compressed?: boolean | "gzip" | "deflate"
  rootName?: string
}

export class NBTWriter {
  private buffer: Buffer
  private offset: number = 0

  constructor(initialSize: number = 1024) {
    this.buffer = Buffer.alloc(initialSize)
  }

  private ensureCapacity(bytesNeeded: number): void {
    while (this.offset + bytesNeeded > this.buffer.length) {
      const newBuffer = Buffer.alloc(this.buffer.length * 2)
      this.buffer.copy(newBuffer)
      this.buffer = newBuffer
    }
  }

  private writeByte(value: number): void {
    this.ensureCapacity(1)
    this.buffer.writeInt8(value, this.offset)
    this.offset += 1
  }

  private writeShort(value: number): void {
    this.ensureCapacity(2)
    this.buffer.writeInt16BE(value, this.offset)
    this.offset += 2
  }

  private writeInt(value: number): void {
    this.ensureCapacity(4)
    this.buffer.writeInt32BE(value, this.offset)
    this.offset += 4
  }

  private writeLong(value: bigint): void {
    this.ensureCapacity(8)
    const high = Number(value >> 32n)
    const low = Number(value & 0xFFFFFFFFn)
    this.buffer.writeInt32BE(high, this.offset)
    this.buffer.writeUInt32BE(low, this.offset + 4)
    this.offset += 8
  }

  private writeFloat(value: number): void {
    this.ensureCapacity(4)
    this.buffer.writeFloatBE(value, this.offset)
    this.offset += 4
  }

  private writeDouble(value: number): void {
    this.ensureCapacity(8)
    this.buffer.writeDoubleBE(value, this.offset)
    this.offset += 8
  }

  private writeName(name: string): void {
    const nameBuffer = Buffer.from(name, "utf-8")
    this.writeShort(nameBuffer.length)
    this.ensureCapacity(nameBuffer.length)
    nameBuffer.copy(this.buffer, this.offset)
    this.offset += nameBuffer.length
  }

  private writeString(value: string): void {
    const strBuffer = Buffer.from(value, "utf-8")
    this.writeShort(strBuffer.length)
    this.ensureCapacity(strBuffer.length)
    strBuffer.copy(this.buffer, this.offset)
    this.offset += strBuffer.length
  }

  private writeByteArray(arr: number[]): void {
    this.writeInt(arr.length)
    for (const byte of arr) {
      this.writeByte(byte)
    }
  }

  private writeIntArray(arr: number[]): void {
    this.writeInt(arr.length)
    for (const int of arr) {
      this.writeInt(int)
    }
  }

  private writeLongArray(arr: bigint[]): void {
    this.writeInt(arr.length)
    for (const long of arr) {
      this.writeLong(long)
    }
  }

  private writeList(list: NBTList): void {
    this.writeByte(list.type)
    this.writeInt(list.values.length)
    for (const value of list.values) {
      this.writeTag(value, list.type)
    }
  }

  private writeCompound(compound: { [key: string]: NBTValue }): void {
    for (const [key, value] of Object.entries(compound)) {
      const tagType = this.getTagType(value)
      this.writeByte(tagType)
      this.writeName(key)
      this.writeTag(value, tagType)
    }
    this.writeByte(TagType.TAG_End)
  }

  private getTagType(value: NBTValue): TagType {
    if (value === null || value === undefined) {
      return TagType.TAG_Byte
    }
    if (typeof value === "number") {
      if (Number.isInteger(value)) {
        if (value >= -128 && value <= 127) {
          return TagType.TAG_Byte
        }
        if (value >= -32768 && value <= 32767) {
          return TagType.TAG_Short
        }
        return TagType.TAG_Int
      }
      return TagType.TAG_Float
    }
    if (typeof value === "bigint") {
      return TagType.TAG_Long
    }
    if (typeof value === "string") {
      return TagType.TAG_String
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return TagType.TAG_Byte_Array
      }
      const firstElement = value[0]
      if (typeof firstElement === "number") {
        if (value.every((v: any) => v >= -128 && v <= 127)) {
          return TagType.TAG_Byte_Array
        }
        if (value.every((v: any) => v >= -32768 && v <= 32767)) {
          return TagType.TAG_Int_Array
        }
        return TagType.TAG_Int_Array
      }
      if (typeof firstElement === "bigint") {
        return TagType.TAG_Long_Array
      }
      return TagType.TAG_List
    }
    if (typeof value === "object" && "type" in value && "values" in value) {
      return TagType.TAG_List
    }
    return TagType.TAG_Compound
  }

  private writeTag(value: NBTValue, tagType: TagType): void {
    switch (tagType) {
      case TagType.TAG_Byte:
        this.writeByte(typeof value === "number" ? value : 0)
        break
      case TagType.TAG_Short:
        this.writeShort(typeof value === "number" ? value : 0)
        break
      case TagType.TAG_Int:
        this.writeInt(typeof value === "number" ? value : 0)
        break
      case TagType.TAG_Long:
        this.writeLong(typeof value === "bigint" ? value : 0n)
        break
      case TagType.TAG_Float:
        this.writeFloat(typeof value === "number" ? value : 0)
        break
      case TagType.TAG_Double:
        this.writeDouble(typeof value === "number" ? value : 0)
        break
      case TagType.TAG_Byte_Array:
        this.writeByteArray(Array.isArray(value) ? value as number[] : [])
        break
      case TagType.TAG_String:
        this.writeString(typeof value === "string" ? value : "")
        break
      case TagType.TAG_List:
        if (typeof value === "object" && value !== null && "type" in value && "values" in value) {
          this.writeList(value as NBTList)
        } else {
          this.writeByte(TagType.TAG_Byte)
          this.writeInt(0)
        }
        break
      case TagType.TAG_Compound:
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          this.writeCompound(value as { [key: string]: NBTValue })
        }
        break
      case TagType.TAG_Int_Array:
        this.writeIntArray(Array.isArray(value) ? value as number[] : [])
        break
      case TagType.TAG_Long_Array:
        this.writeLongArray(Array.isArray(value) ? value as bigint[] : [])
        break
    }
  }

  public write(compound: NBTCompound, options: WriteOptions = {}): Buffer {
    const { rootName = "" } = options

    this.writeByte(TagType.TAG_Compound)
    this.writeName(rootName)
    this.writeCompound(compound)

    const result = this.buffer.subarray(0, this.offset)

    const { compressed } = options
    if (compressed === "gzip" || compressed === true) {
      return zlib.gzipSync(result)
    } else if (compressed === "deflate") {
      return zlib.deflateSync(result)
    }

    return result
  }
}