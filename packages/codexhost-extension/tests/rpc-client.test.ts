import test from "node:test";
import assert from "node:assert/strict";
import { RpcClient, watchEvents } from "../src/frontend/rpc-client";
const size = 512 * 1024;
function chunk(bytes: Buffer, i: number) {
  return {
    chunkIndex: i,
    totalBytes: bytes.length,
    totalChunks: Math.ceil(bytes.length / size),
    base64: bytes.subarray(i * size, (i + 1) * size).toString("base64"),
    fileName: "archive.zip",
    mimeType: "application/zip",
  };
}
test("operation polling resolves a multi-chunk UTF-8 receipt and releases its snapshot", async () => {
  const value = { message: "x".repeat(size - 14) + "议事厅".repeat(30) },
    bytes = Buffer.from(JSON.stringify(value)),
    calls: string[] = [];
  const rpc = new RpcClient({
    async invoke(m, p) {
      calls.push(m);
      if (m.endsWith("/get") && !p.operationId)
        return { operationId: "op", status: "pending" };
      if (p.operationId)
        return {
          downloadId: "json",
          encoding: "json",
          totalBytes: bytes.length,
        };
      if (m.endsWith("/release")) {
        assert.equal(p.transferId, "json");
        return true;
      }
      assert.equal(p.downloadId, "json");
      return chunk(bytes, p.chunkIndex);
    },
  });
  assert.deepEqual(await rpc.call("reports/get"), value);
  assert.equal(calls.filter((c) => c.endsWith("download-chunk")).length, 2);
  assert.ok(calls.at(-1)?.endsWith("release"));
});
test("abort stops operation polling and damaged transfers are released", async () => {
  const c = new AbortController();
  let count = 0;
  const request = new RpcClient({
    async invoke() {
      count++;
      return { operationId: "op", status: "pending" };
    },
  }).call("topics/create", {}, c.signal);
  c.abort();
  await assert.rejects(request);
  assert.equal(count, 1);
  let released = false;
  const rpc = new RpcClient({
    async invoke(m) {
      if (m.endsWith("release")) {
        released = true;
        return;
      }
      if (m.endsWith("download-chunk"))
        return { totalBytes: 2, totalChunks: 1, chunkIndex: 0, base64: "YQ==" };
      return { downloadId: "d", encoding: "json", totalBytes: 2 };
    },
  });
  await assert.rejects(rpc.call("topics/list"), /Incomplete/);
  assert.ok(released);
});
test("binary upload, archive and export downloads preserve bytes and release transfers", async () => {
  const bytes = Buffer.alloc(size + 37, 53),
    parts: Buffer[] = [],
    released: string[] = [];
  const rpc = new RpcClient({
    async invoke(m, p) {
      if (m.endsWith("import-begin")) return { uploadId: "up", totalChunks: 2 };
      if (m.endsWith("import-chunk")) {
        assert.equal(p.chunkIndex, parts.length);
        parts.push(Buffer.from(p.base64, "base64"));
        return;
      }
      if (m.endsWith("import-commit")) return { topicId: "restored" };
      if (m.endsWith("release")) {
        released.push(p.transferId);
        return;
      }
      if (m.includes("archives/")) {
        assert.equal(p.archiveId, "archive");
        return chunk(bytes, p.chunkIndex);
      }
      if (p.chunkIndex === 1) assert.equal(p.downloadId, "down");
      return { ...chunk(bytes, p.chunkIndex), downloadId: "down" };
    },
  });
  assert.deepEqual(
    await rpc.upload(new File([new Uint8Array(bytes)], "c.zip")),
    { topicId: "restored" },
  );
  assert.deepEqual(Buffer.concat(parts), bytes);
  for (const params of [{ archiveId: "archive" }, { format: "archive-zip" }]) {
    let blob: Blob | undefined;
    await rpc.download({ topicId: "c", ...params }, (b, n) => {
      blob = b;
      assert.equal(n, "archive.zip");
    });
    assert.deepEqual(Buffer.from(await blob!.arrayBuffer()), bytes);
  }
  assert.deepEqual(released, ["up", "down"]);
});
test("event cursor advances on truncation and polls pause while hidden and after abort", async () => {
  const doc = Object.assign(new EventTarget(), { hidden: true }),
    ctrl = new AbortController();
  let n = 0,
    refresh = 0;
  const rpc = new RpcClient({
    async invoke(_m, p) {
      assert.equal(p.cursor, n);
      n++;
      return { cursor: n, events: [], truncated: true, activeRunCount: 1 };
    },
  });
  watchEvents(rpc, doc as unknown as Document, ctrl.signal, () => refresh++);
  assert.equal(n, 0);
  doc.hidden = false;
  doc.dispatchEvent(new Event("visibilitychange"));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(refresh, 1);
  doc.hidden = true;
  doc.dispatchEvent(new Event("visibilitychange"));
  doc.hidden = false;
  doc.dispatchEvent(new Event("visibilitychange"));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(n, 2);
  ctrl.abort();
  doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(n, 2);
});

test("event cadence follows active runs and releases its scheduled timer on abort", async () => {
  const original = globalThis.setTimeout,
    cancel = globalThis.clearTimeout;
  let timer: { ms: number; callback: () => void } | undefined,
    n = 0,
    refresh = 0;
  const doc = Object.assign(new EventTarget(), { hidden: false }),
    ctrl = new AbortController();
  try {
    globalThis.setTimeout = ((fn: () => void, ms: number) => {
      timer = { ms, callback: fn };
      return 1;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = (() => {
      timer = undefined;
    }) as typeof clearTimeout;
    watchEvents(
      new RpcClient({
        async invoke() {
          return {
            cursor: ++n,
            events: n === 1 ? [{}] : [],
            truncated: false,
            activeRunCount: n === 1 ? 1 : 0,
          };
        },
      }),
      doc as unknown as Document,
      ctrl.signal,
      () => refresh++,
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(timer?.ms, 1500);
    timer!.callback();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(timer?.ms, 4000);
    assert.equal(refresh, 1);
    ctrl.abort();
    assert.equal(timer, undefined);
  } finally {
    ctrl.abort();
    globalThis.setTimeout = original;
    globalThis.clearTimeout = cancel;
  }
});
