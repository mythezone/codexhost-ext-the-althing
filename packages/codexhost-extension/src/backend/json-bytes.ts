import { isUtf8 } from "node:buffer";
import { JSONParser } from "@streamparser/json";

export function parseJsonBytes(bytes: Buffer, nativeLimit = 1024 * 1024) {
  if (!isUtf8(bytes)) throw Error("Invalid UTF-8 JSON");
  if (bytes.length < nativeLimit) return JSON.parse(bytes.toString("utf8"));
  const parser = new JSONParser({ stringBufferSize: 65536 });
  let result: unknown;
  parser.onValue = ({ value, parent, key, stack }) => {
    // Match JSON.parse for this legal object key even on parsers using ordinary assignment.
    if (parent && key === "__proto__") {
      Object.setPrototypeOf(parent, Object.prototype);
      Object.defineProperty(parent, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    if (!stack.length) result = value;
  };
  for (let offset = 0; offset < bytes.length; offset += 65536)
    parser.write(bytes.subarray(offset, offset + 65536));
  if (!parser.isEnded) parser.end();
  return result;
}

// Keep large council documents in byte buffers. One contiguous JSON string can
// otherwise occupy most of the Host heap while the source tree is still live.
export function jsonBytes(value: unknown): Buffer {
  const buffers: Buffer[] = [];
  let pending = "";
  function add(text: string) {
    pending += text;
    if (pending.length >= 32768) {
      buffers.push(Buffer.from(pending));
      pending = "";
    }
  }
  function write(v: unknown) {
    if (typeof v === "string" && v.length > 32768) {
      add('"');
      for (let start = 0; start < v.length; ) {
        let end = Math.min(start + 32768, v.length);
        if (
          end < v.length &&
          v.charCodeAt(end - 1) >= 0xd800 &&
          v.charCodeAt(end - 1) <= 0xdbff
        )
          end--;
        add(JSON.stringify(v.slice(start, end)).slice(1, -1));
        start = end;
      }
      add('"');
      return;
    }
    if (Array.isArray(v)) {
      add("[");
      for (let i = 0; i < v.length; i++) {
        if (i) add(",");
        write(v[i]);
      }
      add("]");
      return;
    }
    if (v !== null && typeof v === "object") {
      add("{");
      let first = true;
      for (const [key, item] of Object.entries(v)) {
        if (!first) add(",");
        first = false;
        add(JSON.stringify(key) + ":");
        write(item);
      }
      add("}");
      return;
    }
    if (
      v === undefined ||
      (typeof v === "number" && !Number.isFinite(v)) ||
      !["string", "boolean", "object", "number"].includes(typeof v)
    )
      throw Error("Invalid JSON value");
    add(JSON.stringify(v));
  }
  write(value);
  if (pending) buffers.push(Buffer.from(pending));
  return buffers.length === 1 ? buffers[0] : Buffer.concat(buffers);
}
