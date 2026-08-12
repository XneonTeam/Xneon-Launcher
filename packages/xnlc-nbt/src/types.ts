export enum TagType {
  TAG_End = 0,
  TAG_Byte = 1,
  TAG_Short = 2,
  TAG_Int = 3,
  TAG_Long = 4,
  TAG_Float = 5,
  TAG_Double = 6,
  TAG_Byte_Array = 7,
  TAG_String = 8,
  TAG_List = 9,
  TAG_Compound = 10,
  TAG_Int_Array = 11,
  TAG_Long_Array = 12,
}

export interface NBTList {
  type: TagType
  values: NBTValue[]
}

export type NBTValue =
  | number
  | bigint
  | string
  | NBTValue[]
  | NBTList
  | { [key: string]: NBTValue }
  | null

export interface NBTCompound {
  [key: string]: NBTValue
}