export type Backend = {
  invoke: (method: string, params?: any) => Promise<any>;
};
type Params = Record<string, unknown>;
type Chunk = {
  base64: string;
  totalBytes: number;
  totalChunks: number;
  chunkIndex: number;
  mimeType: string;
  fileName: string;
  downloadId?: string;
};
const chunkBytes = 512 * 1024;
function pause(ms: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
function base64(bytes: Uint8Array) {
  let text = "";
  for (let n = 0; n < bytes.length; n += 8192)
    text += String.fromCharCode(...bytes.subarray(n, n + 8192));
  return btoa(text);
}
export function saveBlob(blob: Blob, name: string, doc = document) {
  const url = URL.createObjectURL(blob),
    a = doc.createElement("a");
  try {
    a.href = url;
    a.download = name;
    a.hidden = true;
    doc.body.append(a);
    a.click();
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export class RpcClient {
  constructor(
    private backend: Backend,
    readonly signal?: AbortSignal,
  ) {}
  private async result(method: string, params: Params, signal?: AbortSignal) {
    signal?.throwIfAborted();
    let v = await this.backend.invoke("althing/" + method, params);
    while (v?.operationId && v.status === "pending") {
      await pause(250, signal);
      signal?.throwIfAborted();
      v = await this.backend.invoke("althing/operations/get", {
        operationId: v.operationId,
      });
    }
    return v;
  }
  private release(transferId: string) {
    return this.result("transfers/release", { transferId });
  }
  private async assemble(
    first: Chunk,
    next: (index: number) => Promise<Chunk>,
    signal?: AbortSignal,
  ) {
    if (
      !Number.isSafeInteger(first.totalBytes) ||
      first.totalBytes < 0 ||
      first.totalChunks !==
        Math.max(1, Math.ceil(first.totalBytes / chunkBytes))
    )
      throw Error("Invalid transfer size");
    const bytes = new Uint8Array(first.totalBytes);
    for (let i = 0; i < first.totalChunks; i++) {
      signal?.throwIfAborted();
      const part = i === 0 ? first : await next(i);
      const raw = atob(part.base64);
      if (
        part.totalChunks !== first.totalChunks ||
        part.chunkIndex !== i ||
        part.totalBytes !== first.totalBytes ||
        raw.length !== Math.min(chunkBytes, bytes.length - i * chunkBytes)
      )
        throw Error("Incomplete transfer");
      for (let j = 0; j < raw.length; j++)
        bytes[i * chunkBytes + j] = raw.charCodeAt(j);
    }
    return bytes;
  }
  async call<T = unknown>(
    method: string,
    params: Params = {},
    signal = this.signal,
  ): Promise<T> {
    const v = await this.result(method, params, signal);
    if (v?.encoding === "json" && v.downloadId) {
      try {
        const part = (chunkIndex: number) =>
          this.result(
            "exports/download-chunk",
            { downloadId: v.downloadId, chunkIndex },
            signal,
          );
        const first = await part(0);
        if (first.totalBytes !== v.totalBytes)
          throw Error("JSON transfer size changed");
        return JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await this.assemble(first, part, signal),
          ),
        );
      } finally {
        await this.release(v.downloadId);
      }
    }
    signal?.throwIfAborted();
    return v as T;
  }
  async download(
    params: { topicId: string; archiveId?: string; format?: string },
    save = saveBlob,
  ) {
    const method = params.archiveId
        ? "archives/download-chunk"
        : "exports/download-chunk",
      signal = this.signal;
    const first: Chunk = await this.result(
      method,
      { ...params, chunkIndex: 0 },
      signal,
    );
    try {
      const bytes = await this.assemble(
        first,
        (chunkIndex) =>
          this.result(
            method,
            {
              ...(first.downloadId ? { downloadId: first.downloadId } : params),
              chunkIndex,
            },
            signal,
          ),
        signal,
      );
      signal?.throwIfAborted();
      save(new Blob([bytes], { type: first.mimeType }), first.fileName);
    } finally {
      if (first.downloadId) await this.release(first.downloadId);
    }
  }
  async upload(file: File) {
    const signal = this.signal,
      begin = await this.result(
        "archives/import-begin",
        { totalBytes: file.size },
        signal,
      );
    try {
      for (let i = 0; i < begin.totalChunks; i++) {
        signal?.throwIfAborted();
        const bytes = new Uint8Array(
          await file.slice(i * chunkBytes, (i + 1) * chunkBytes).arrayBuffer(),
        );
        await this.result(
          "archives/import-chunk",
          { uploadId: begin.uploadId, chunkIndex: i, base64: base64(bytes) },
          signal,
        );
      }
      return (await this.result(
        "archives/import-commit",
        { uploadId: begin.uploadId },
        signal,
      )) as { topicId: string };
    } finally {
      await this.release(begin.uploadId);
    }
  }
}
export function watchEvents(
  rpc: RpcClient,
  doc: Document,
  signal: AbortSignal,
  refresh: () => void,
  onError?: (error: Error) => void,
) {
  let cursor = 0,
    busy = false,
    delay = 4000,
    timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    clearTimeout(timer);
    if (!signal.aborted && !doc.hidden) timer = setTimeout(poll, delay);
  };
  async function poll() {
    if (busy || signal.aborted || doc.hidden) return;
    busy = true;
    try {
      const v = await rpc.call<{
        cursor: number;
        activeRunCount: number;
        events: unknown[];
        truncated: boolean;
      }>("events/since", { cursor }, signal);
      cursor = v.cursor;
      delay = v.activeRunCount > 0 ? 1500 : 4000;
      if (!signal.aborted && (v.truncated || v.events.length)) refresh();
    } catch (e) {
      if (!signal.aborted) onError?.(e as Error);
    } finally {
      busy = false;
      schedule();
    }
  }
  const visibility = () => {
    clearTimeout(timer);
    if (!doc.hidden) void poll();
  };
  const stop = () => {
    clearTimeout(timer);
    doc.removeEventListener("visibilitychange", visibility);
  };
  if (!signal.aborted) {
    doc.addEventListener("visibilitychange", visibility);
    signal.addEventListener("abort", stop, { once: true });
    void poll();
  }
}
