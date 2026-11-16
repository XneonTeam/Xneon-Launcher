const encoder = new TextEncoder();
const byteMaps = new Map<string, Map<string, number>>();

/** TextEncoder умеет только UTF-8. Однобайтные Windows-кодировки обращаем через TextDecoder. */
function singleByteEncoding(label: string): string | undefined {
  const value = label.toLowerCase().replace(/[-_]/g, "");
  const windows = /^(?:windows|cp)(125[0-8]|874)$/.exec(value);
  if (windows) return `windows-${windows[1]}`;
  if (/^(?:cp|ibm)?866$/.test(value)) return "ibm866";
  return undefined;
}

function fail(encoding: string): never {
  throw new Error(`Java argument file encoding ${encoding} cannot represent the launch paths`);
}

/**
 * Только кодирование Java @argfile, не общий конкурент HTTP/encoding-библиотекам.
 * Проверка roundtrip обязательна: нельзя незаметно заменить символ пути на '?'.
 */
export async function encodeJavaArgFile(content: string, encoding: string): Promise<Uint8Array> {
  const label = encoding.toLowerCase().replace(/[-_]/g, "");
  if (label === "utf8") {
    const bytes = encoder.encode(content);
    if (new TextDecoder("utf-8").decode(bytes) !== content) fail(encoding);
    return bytes;
  }
  if (label === "utf16le" || label === "ucs2") {
    const bytes = Buffer.from(content, "utf16le");
    if (new TextDecoder("utf-16le").decode(bytes) !== content) fail(encoding);
    return bytes;
  }
  if (label === "ascii" || label === "usascii") {
    // WHATWG TextDecoder('ascii') — Windows-1252, поэтому ASCII проверяется явно.
    if (/[^\x00-\x7f]/.test(content)) fail(encoding);
    return encoder.encode(content);
  }
  const native = singleByteEncoding(encoding);
  if (native) {
    const decoder = new TextDecoder(native);
    let map = byteMaps.get(decoder.encoding);
    if (!map) {
      map = new Map<string, number>();
      for (let byte = 0; byte < 256; byte++) {
        const character = decoder.decode(Uint8Array.of(byte));
        if (character !== "\uFFFD" && !map.has(character)) map.set(character, byte);
      }
      byteMaps.set(decoder.encoding, map);
    }
    const bytes = new Uint8Array(content.length);
    let offset = 0;
    for (const character of content) {
      const byte = map.get(character);
      if (byte === undefined) fail(encoding);
      bytes[offset++] = byte;
    }
    if (decoder.decode(bytes) !== content) fail(encoding);
    return bytes;
  }
  // Японская/китайская Windows и другие JVM Charset: стандартного TextEncoder
  // для них нет. Сохраняем прежний специализированный кодек, загружая его лениво.
  const { default: legacy } = await import("iconv-lite");
  if (!legacy.encodingExists(encoding)) throw new Error(`Unsupported Java argument file encoding: ${encoding}`);
  const bytes = legacy.encode(content, encoding);
  if (legacy.decode(bytes, encoding) !== content) fail(encoding);
  return bytes;
}
