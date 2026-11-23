import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { jsonBytes, parseJsonBytes } from "./json-bytes.ts";
import { Council, toCard, type StoredTopic } from "./domain/council.ts";
import {
  id,
  now,
  uid,
  reportHead,
  type Card,
  type Report,
} from "./domain/models.ts";
import { MAX_BYTES } from "./domain/zip.ts";

export const CHUNK = 512 * 1024;
type Settings = Record<string, unknown>;
export function resolveDataDir(ctx: { dataDir: string }, settings: Settings) {
  const v = typeof settings.dataDir === "string" ? settings.dataDir.trim() : "";
  return v &&
    path.isAbsolute(v) &&
    !v.includes("\0") &&
    !v.split(/[/\\]/).includes("..")
    ? path.resolve(v)
    : path.resolve(ctx.dataDir);
}
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";
async function syncDirectory(name: string) {
  if (process.platform === "win32") return;
  const h = await fs.open(
    name,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await h.sync();
  } finally {
    await h.close();
  }
}
async function openRoot(root: string) {
  let ancestor = path.resolve(root);
  const segments: string[] = [];
  while (true) {
    try {
      const entry = await fs.lstat(ancestor);
      if (!entry.isDirectory() && !(segments.length && entry.isSymbolicLink()))
        throw Error("Unsafe storage directory");
      break;
    } catch (e) {
      const parent = path.dirname(ancestor);
      if (!missing(e) || parent === ancestor) throw e;
      segments.push(path.basename(ancestor));
      ancestor = parent;
    }
  }
  let canonical = await fs.realpath(ancestor);
  if (!(await fs.lstat(canonical)).isDirectory())
    throw Error("Unsafe storage directory");
  for (const segment of segments.reverse()) {
    const child = path.join(canonical, segment);
    try {
      await fs.mkdir(child, { mode: 0o700 });
      await syncDirectory(canonical);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    if (!(await fs.lstat(child)).isDirectory())
      throw Error("Unsafe storage directory");
    canonical = child;
  }
  return canonical;
}
type Event = {
  id: number;
  type: string;
  topic_id: string;
  resource_id: string;
  timestamp: string;
};
type Index = {
  schemaVersion: 1;
  eventSeq: number;
  topicIds: string[];
  cards: Card[];
  resourceIds: Record<string, string[]>;
};
type Journal = {
  files: { temp: string; target: string }[];
  remove: string[];
  events: Event[];
};
export type Files = Map<string, string | Buffer>;
export const topicPath = (tid: string) => "topics/" + id.parse(tid);
export const reportPath = (tid: string, rid: string) =>
  topicPath(tid) + "/reports/" + id.parse(rid) + ".json";
export const archivePath = (tid: string, aid: string) =>
  topicPath(tid) + "/archives/" + id.parse(aid) + ".zip";
const transfer = (key: string) => "transfers/" + id.parse(key);
export type Chunk = {
  totalBytes: number;
  chunkIndex: number;
  totalChunks: number;
  base64: string;
  fileName: string;
  mimeType: string;
};
export class Store {
  private tail: Promise<unknown> = Promise.resolve();
  private constructor(readonly root: string) {}
  static async open(root: string) {
    const s = new Store(await openRoot(root));
    await s.recover();
    if (!(await s.exists("index.json")))
      await s.atomic(
        "index.json",
        JSON.stringify({
          schemaVersion: 1,
          eventSeq: 0,
          topicIds: [],
          cards: [],
          resourceIds: {},
        }),
      );
    if (!(await s.exists("events.jsonl"))) await s.atomic("events.jsonl", "");
    return s;
  }
  serial<T>(fn: () => Promise<T>) {
    const result = this.tail.then(async () => {
      await this.recover();
      return fn();
    });
    this.tail = result.catch(() => {});
    return result;
  }
  async drain() {
    await this.tail;
  }
  private async safe(rel: string, parents = false) {
    if (
      !rel ||
      rel
        .split("/")
        .some((s) => !s || s === "." || s === ".." || /[\\:\0]/u.test(s))
    )
      throw Error("Unsafe storage path");
    if (!(await fs.lstat(this.root)).isDirectory())
      throw Error("Unsafe storage root");
    const parts = rel.split("/");
    let target = this.root;
    for (const [i, part] of parts.entries()) {
      target = path.join(target, part);
      try {
        const st = await fs.lstat(target);
        if (st.isSymbolicLink() || (i < parts.length - 1 && !st.isDirectory()))
          throw Error("Unsafe storage path");
      } catch (e) {
        if (!missing(e)) throw e;
        if (parents && i < parts.length - 1) {
          await fs.mkdir(target, { mode: 0o700 });
          await syncDirectory(path.dirname(target));
        }
      }
    }
    return target;
  }
  private async exists(rel: string) {
    try {
      await fs.lstat(await this.safe(rel));
      return true;
    } catch (e) {
      if (missing(e)) return false;
      throw e;
    }
  }
  private async atomic(rel: string, bytes: Buffer | string) {
    const target = await this.safe(rel, true),
      temp = path.join(path.dirname(target), "." + uid() + ".tmp");
    const f = await fs.open(temp, "wx", 0o600);
    try {
      try {
        await f.writeFile(bytes);
        await f.sync();
      } finally {
        await f.close();
      }
      await fs.rename(temp, target);
      await syncDirectory(path.dirname(target));
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
  private async openFile(rel: string) {
    const h = await fs.open(
      await this.safe(rel),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    if (!(await h.stat()).isFile()) {
      await h.close();
      throw Error("Expected regular file");
    }
    return h;
  }
  async read(rel: string) {
    const h = await this.openFile(rel);
    try {
      return await h.readFile();
    } finally {
      await h.close();
    }
  }
  private async json<T>(rel: string): Promise<T> {
    return parseJsonBytes(await this.read(rel));
  }
  private async index() {
    const index = await this.json<Index>("index.json");
    if (index.schemaVersion !== 1) throw Error("Unsupported index version");
    return index;
  }
  private async recover() {
    if (!(await this.exists("journal.json"))) return;
    const j = await this.json<Journal>("journal.json");
    for (const { temp, target } of j.files)
      if (await this.exists(temp))
        await fs.rename(await this.safe(temp), await this.safe(target, true));
    for (const rel of j.remove)
      await fs.rm(await this.safe(rel), { recursive: true, force: true });
    if (j.events.length) {
      const text = (await this.exists("events.jsonl"))
        ? (await this.read("events.jsonl")).toString()
        : "";
      const complete = text.slice(0, text.lastIndexOf("\n") + 1);
      const lines = complete.trimEnd().split("\n").filter(Boolean);
      const last = lines.length ? Number(JSON.parse(lines.at(-1)!).id) : 0;
      const append = j.events
        .filter((e) => e.id > last)
        .map((e) => JSON.stringify(e));
      if (lines.length + append.length > 2000 || text !== complete)
        await this.atomic(
          "events.jsonl",
          [...lines, ...append].slice(-1000).join("\n") + "\n",
        );
      else if (append.length) {
        const h = await fs.open(
          await this.safe("events.jsonl"),
          constants.O_CREAT |
            constants.O_APPEND |
            constants.O_WRONLY |
            constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await h.writeFile(append.join("\n") + "\n");
          await h.sync();
        } finally {
          await h.close();
        }
      }
    }
    for (const directory of new Set(
      j.files
        .map((f) => path.dirname(path.join(this.root, f.target)))
        .concat(j.remove.map((rel) => path.dirname(path.join(this.root, rel)))),
    ))
      await syncDirectory(directory);
    await fs.unlink(await this.safe("journal.json"));
    await syncDirectory(this.root);
  }
  private async commit(files: Files, remove: string[], events: Event[]) {
    const j: Journal = { files: [], remove, events };
    try {
      for (const [target, data] of files) {
        await this.safe(target, true);
        const temp = "staging/" + uid();
        await this.atomic(temp, data);
        j.files.push({ temp, target });
      }
      await this.atomic("journal.json", JSON.stringify(j));
    } catch (e) {
      for (const f of j.files)
        await fs.rm(await this.safe(f.temp), { force: true });
      throw e;
    }
    await this.recover();
  }
  async load(tid: string) {
    const tree = await this.json<StoredTopic>(topicPath(tid) + "/topic.json");
    if (tree.id !== tid) throw Error("Unknown topic");
    return tree;
  }
  async report(tid: string, rid: string) {
    const report = await this.json<Report>(reportPath(tid, rid));
    if (report.id !== rid || report.topic_id !== tid)
      throw Error("Unknown report");
    return report;
  }
  async full(tree: StoredTopic) {
    const reports: Report[] = [];
    for (const r of tree.reports)
      reports.push(
        r.html_content !== undefined ? r : await this.report(tree.id, r.id),
      );
    return { ...tree, reports };
  }
  transaction<T>(
    tid: string | null,
    change: (c: Council, files: Files) => T | Promise<T>,
  ) {
    return this.serial(async () => {
      const index = await this.index(),
        files: Files = new Map();
      const c = new Council(tid === null ? undefined : await this.load(tid));
      const value = await change(c, files),
        t = c.tree;
      if (!t) throw Error("Missing topic");
      if (
        tid === null &&
        (index.topicIds.includes(t.id) ||
          (await this.exists(topicPath(t.id) + "/topic.json")))
      )
        throw Error("Topic ID already exists");
      if (!c.events.length && !files.size) return value;
      const newIds = [
        ...c.insertedIds,
        ...t.archives
          .filter((a) => files.has(archivePath(t.id, a.id)))
          .map((a) => a.id),
      ];
      if (newIds.length) {
        const occupied = new Set(Object.values(index.resourceIds).flat());
        for (const key of newIds) {
          if (occupied.has(key)) throw Error("Resource ID already exists");
          occupied.add(key);
        }
        const own = Object.hasOwn(index.resourceIds, t.id)
          ? index.resourceIds[t.id]
          : [];
        index.resourceIds = {
          ...index.resourceIds,
          [t.id]: [...own, ...newIds],
        };
      }
      const card = toCard(t);
      for (const r of t.reports)
        if (r.html_content !== undefined) {
          const target = reportPath(t.id, r.id);
          if (await this.exists(target))
            throw Error("Report file already exists");
          files.set(target, jsonBytes(r));
        }
      files.set(
        topicPath(t.id) + "/topic.json",
        jsonBytes({ ...t, reports: t.reports.map(reportHead) }),
      );
      const pos = index.topicIds.indexOf(t.id);
      if (pos < 0) {
        index.topicIds.push(t.id);
        index.cards.push(card);
      } else index.cards[pos] = card;
      const events = c.events.map((e) => ({
        ...e,
        id: ++index.eventSeq,
        topic_id: t.id,
        timestamp: now(),
      }));
      files.set("index.json", JSON.stringify(index));
      await this.commit(files, [], events);
      return value;
    });
  }
  remove(tid: string) {
    return this.serial(async () => {
      const idx = await this.index(),
        pos = idx.topicIds.indexOf(id.parse(tid));
      if (pos < 0) throw Error("Unknown topic");
      if (idx.cards[pos].activeRunCount)
        throw Error("Cancel active runs before deleting a topic");
      delete idx.resourceIds[tid];
      idx.topicIds.splice(pos, 1);
      idx.cards.splice(pos, 1);
      const event = {
        id: ++idx.eventSeq,
        type: "topic.deleted",
        topic_id: tid,
        resource_id: tid,
        timestamp: now(),
      };
      await this.commit(
        new Map([["index.json", JSON.stringify(idx)]]),
        [topicPath(tid)],
        [event],
      );
      return { id: tid };
    });
  }
  list(
    filter: {
      status?: string;
      q?: string;
      tag?: string;
      projectCwd?: string;
    } = {},
  ) {
    return this.serial(async () => {
      const matches: Card[] = [],
        query = filter.q?.toLowerCase();
      for (const c of (await this.index()).cards.reverse()) {
        if (
          (filter.status && c.status !== filter.status) ||
          (filter.tag && !c.domain_tags.includes(filter.tag)) ||
          (filter.projectCwd && c.projectCwd !== filter.projectCwd)
        )
          continue;
        if (
          query &&
          ![c.title, c.subtitle, c.description, ...c.domain_tags]
            .join(" ")
            .toLowerCase()
            .includes(query)
        ) {
          if (
            c.description.length < 2048 ||
            !(await this.load(c.id)).description.toLowerCase().includes(query)
          )
            continue;
        }
        matches.push(c);
      }
      return matches;
    });
  }
  since(cursor = 0, tid?: string) {
    return this.serial(async () => {
      const idx = await this.index();
      const all: Event[] = (await this.read("events.jsonl"))
        .toString()
        .trimEnd()
        .split("\n")
        .filter(Boolean)
        .map((s) => JSON.parse(s));
      const events = all
        .filter((e) => e.id > cursor && (!tid || e.topic_id === tid))
        .slice(0, 128);
      return {
        cursor: events.length === 128 ? events.at(-1)!.id : idx.eventSeq,
        events,
        truncated: !!all.length && cursor < all[0].id - 1,
        activeRunCount: idx.cards
          .filter((c) => !tid || c.id === tid)
          .reduce((n, c) => n + c.activeRunCount, 0),
      };
    });
  }
  async chunk(
    rel: string,
    index: number,
    fileName: string,
    mimeType: string,
  ): Promise<Chunk> {
    const h = await this.openFile(rel);
    try {
      const totalBytes = (await h.stat()).size,
        totalChunks = Math.max(1, Math.ceil(totalBytes / CHUNK));
      if (!Number.isSafeInteger(index) || index < 0 || index >= totalChunks)
        throw Error("Invalid chunk index");
      const buf = Buffer.alloc(Math.min(CHUNK, totalBytes - index * CHUNK));
      let offset = 0;
      while (offset < buf.length) {
        const { bytesRead } = await h.read(
          buf,
          offset,
          buf.length - offset,
          index * CHUNK + offset,
        );
        if (!bytesRead) throw Error("Incomplete read");
        offset += bytesRead;
      }
      return {
        totalBytes,
        chunkIndex: index,
        totalChunks,
        base64: buf.toString("base64"),
        fileName,
        mimeType,
      };
    } finally {
      await h.close();
    }
  }
  cacheDownload(bytes: Buffer, fileName: string, mimeType: string) {
    return this.serial(async () => {
      const downloadId = uid(),
        rel = transfer(downloadId);
      await this.atomic(rel + "/data", bytes);
      await this.atomic(
        rel + "/download.json",
        JSON.stringify({ fileName, mimeType }),
      );
      return downloadId;
    });
  }
  async download(downloadId: string, index: number) {
    const rel = transfer(downloadId),
      { fileName, mimeType } = await this.json<{
        fileName: string;
        mimeType: string;
      }>(rel + "/download.json");
    return {
      ...(await this.chunk(rel + "/data", index, fileName, mimeType)),
      downloadId,
    };
  }
  begin(totalBytes: number) {
    return this.serial(async () => {
      if (
        !Number.isSafeInteger(totalBytes) ||
        totalBytes < 1 ||
        totalBytes > MAX_BYTES
      )
        throw Error("Invalid archive size");
      const uploadId = uid();
      await this.atomic(
        transfer(uploadId) + "/upload.json",
        JSON.stringify({ totalBytes }),
      );
      return {
        uploadId,
        totalBytes,
        chunkBytes: CHUNK,
        totalChunks: Math.ceil(totalBytes / CHUNK),
      };
    });
  }
  upload(uploadId: string, index: number, base64: string) {
    return this.serial(async () => {
      const rel = transfer(uploadId),
        { totalBytes } = await this.json<{ totalBytes: number }>(
          rel + "/upload.json",
        );
      const length = Math.min(CHUNK, totalBytes - index * CHUNK);
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        length <= 0 ||
        typeof base64 !== "string" ||
        base64.length !== 4 * Math.ceil(length / 3)
      )
        throw Error("Invalid upload chunk");
      const bytes = Buffer.from(base64, "base64");
      if (bytes.length !== length || bytes.toString("base64") !== base64)
        throw Error("Invalid base64 chunk");
      const dest = rel + "/" + index;
      if (await this.exists(dest)) {
        if (!(await this.read(dest)).equals(bytes))
          throw Error("Conflicting upload chunk");
      } else await this.atomic(dest, bytes);
      return { uploadId, chunkIndex: index };
    });
  }
  async uploaded(key: string) {
    const rel = transfer(key),
      { totalBytes } = await this.json<{ totalBytes: number }>(
        rel + "/upload.json",
      );
    const result = Buffer.alloc(totalBytes);
    for (let i = 0; i < Math.ceil(totalBytes / CHUNK); i++) {
      const part = await this.read(rel + "/" + i);
      if (part.length !== Math.min(CHUNK, totalBytes - i * CHUNK))
        throw Error("Incomplete upload");
      part.copy(result, i * CHUNK);
    }
    return result;
  }
  async receipt(key: string) {
    const rel = transfer(key) + "/receipt.json";
    return (await this.exists(rel))
      ? await this.json<{ topicId: string }>(rel)
      : null;
  }
  receiptPath(key: string) {
    return transfer(key) + "/receipt.json";
  }
  async release(key: string) {
    await fs.rm(await this.safe(transfer(key)), {
      recursive: true,
      force: true,
    });
    return null;
  }
}
