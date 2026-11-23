import * as zlib from "node:zlib";
export const MAX_BYTES = 64 * 1024 * 1024,
  MAX_ENTRIES = 2048;
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});
export function crc32(bytes: Buffer) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(bytes);
  let c = 0xffffffff;
  for (const b of bytes) c = (c >>> 8) ^ crcTable[(c ^ b) & 255];
  return (c ^ 0xffffffff) >>> 0;
}
function check(test: unknown, message: string): asserts test {
  if (!test) throw Error("Invalid ZIP: " + message);
}
function safeName(name: string) {
  check(
    name.length &&
      Buffer.byteLength(name) <= 65535 &&
      !/[\\:\x00-\x1f]/u.test(name) &&
      name.split("/").every((part) => part && part !== ".." && part !== "."),
    "unsafe member name",
  );
}
export function writeZip(files: Map<string, Buffer>) {
  check(files.size <= MAX_ENTRIES, "too many members");
  const chunks: Buffer[] = [],
    directory: Buffer[] = [];
  let offset = 0,
    total = 0;
  for (const [name, data] of files) {
    safeName(name);
    total += data.length;
    check(total <= MAX_BYTES, "portable size limit");
    const encoded = Buffer.from(name),
      deflated = zlib.deflateRawSync(data, { level: 1 });
    const method = deflated.length < data.length ? 8 : 0,
      packed = method ? deflated : data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(encoded.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    local.copy(central, 6, 4, 30);
    central.writeUInt32LE(offset, 42);
    chunks.push(local, encoded, packed);
    directory.push(central, encoded);
    offset += local.length + encoded.length + packed.length;
  }
  const central = Buffer.concat(directory),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  check(offset + central.length + 22 <= MAX_BYTES, "compressed size limit");
  return Buffer.concat([...chunks, central, end]);
}
export function readZip(blob: Buffer) {
  check(blob.length >= 22 && blob.length <= MAX_BYTES, "size limit");
  let end = blob.length - 22;
  while (
    end >= Math.max(0, blob.length - 65557) &&
    (blob.readUInt32LE(end) !== 0x06054b50 ||
      end + 22 + blob.readUInt16LE(end + 20) !== blob.length)
  )
    end--;
  check(end >= Math.max(0, blob.length - 65557), "missing end of directory");
  const count = blob.readUInt16LE(end + 10),
    start = blob.readUInt32LE(end + 16);
  check(
    !blob.readUInt32LE(end + 4) &&
      count === blob.readUInt16LE(end + 8) &&
      count <= MAX_ENTRIES,
    "member count or split archive",
  );
  check(start + blob.readUInt32LE(end + 12) === end, "directory bounds");
  const files = new Map<string, Buffer>(),
    ranges: [number, number][] = [];
  let at = start,
    total = 0;
  for (let i = 0; i < count; i++) {
    check(
      at + 46 <= end && blob.readUInt32LE(at) === 0x02014b50,
      "central header",
    );
    const flags = blob.readUInt16LE(at + 8),
      method = blob.readUInt16LE(at + 10),
      crc = blob.readUInt32LE(at + 16);
    const packed = blob.readUInt32LE(at + 20),
      size = blob.readUInt32LE(at + 24),
      nl = blob.readUInt16LE(at + 28);
    const local = blob.readUInt32LE(at + 42),
      nameBytes = blob.subarray(at + 46, at + 46 + nl);
    check(
      !(flags & ~0x80e) &&
        [0, 8].includes(method) &&
        !blob.readUInt16LE(at + 34),
      "unsupported ZIP",
    );
    const name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    safeName(name);
    check(!files.has(name), "duplicate member");
    total += size;
    check(total <= MAX_BYTES, "expanded size limit");
    at += 46 + nl + blob.readUInt16LE(at + 30) + blob.readUInt16LE(at + 32);
    check(at <= end, "member bounds");
    check(
      local + 30 <= start && blob.readUInt32LE(local) === 0x04034b50,
      "local header",
    );
    check(
      blob.readUInt16LE(local + 6) === flags &&
        blob.readUInt16LE(local + 8) === method &&
        blob.readUInt16LE(local + 26) === nl &&
        nameBytes.equals(blob.subarray(local + 30, local + 30 + nl)),
      "local header mismatch",
    );
    if (!(flags & 8))
      check(
        blob.readUInt32LE(local + 14) === crc &&
          blob.readUInt32LE(local + 18) === packed &&
          blob.readUInt32LE(local + 22) === size,
        "local sizes",
      );
    const data = local + 30 + nl + blob.readUInt16LE(local + 28),
      limit = data + packed;
    check(limit <= start, "compressed data bounds");
    let next = limit;
    if (flags & 8) {
      if (blob.readUInt32LE(next) === 0x08074b50) next += 4;
      check(
        next + 12 <= start &&
          blob.readUInt32LE(next) === crc &&
          blob.readUInt32LE(next + 4) === packed &&
          blob.readUInt32LE(next + 8) === size,
        "data descriptor",
      );
      next += 12;
    }
    ranges.push([local, next]);
    const payload = blob.subarray(data, limit);
    const decoded = method
      ? zlib.inflateRawSync(payload, { maxOutputLength: Math.max(size, 1) })
      : payload;
    check(
      decoded.length === size && crc32(decoded) === crc,
      "size or CRC mismatch",
    );
    files.set(name, decoded);
  }
  check(at === end, "directory length");
  ranges.sort((a, b) => a[0] - b[0]);
  let last = 0;
  for (const [from, to] of ranges) {
    check(from >= last, "overlapping members");
    last = to;
  }
  return files;
}
