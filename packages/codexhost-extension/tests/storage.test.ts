import test from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
  realpath,
  writeFile,
  mkdir,
  symlink,
  stat,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Store, resolveDataDir, CHUNK } from "../src/backend/storage.ts";
import { fixture, temp } from "./helpers.ts";

test("serialized updates, separated bodies, private files, filters and cursor replay after reopen", async (t) => {
  const root = await temp(t),
    store = await Store.open(root);
  await store.transaction(null, (c) => c.create("topic", fixture));
  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      store.transaction("study", (c) =>
        c.create("agenda", { title: "Agenda " + i }, "study"),
      ),
    ),
  );
  const tree = await store.load("study");
  assert.equal(new Set(tree.agendas.map((a) => a.order_index)).size, 26);
  await assert.rejects(
    store.transaction("study", (c) =>
      c.create("sub_agenda", { title: "Broken", depends_on: ["absent"] }, "a"),
    ),
  );
  assert.equal((await store.load("study")).agendas[0].sub_agendas.length, 2);
  const r = await store.transaction("study", (c) =>
    c.create(
      "report",
      { title: "R", markdown_content: "Full report body" },
      "study",
    ),
  );
  assert.ok(
    !(
      await readFile(path.join(root, "topics/study/topic.json"), "utf8")
    ).includes("Full report body"),
  );
  assert.ok((await store.report("study", r.id)).html_content);
  const reopened = await Store.open(root),
    cards = await reopened.list({
      projectCwd: "/projects/study",
      q: "evidence",
      tag: "science",
      status: "draft",
    });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].agenda_count, 26);
  assert.equal(cards[0].report_count, 1);
  assert.equal((await store.list({ projectCwd: "/elsewhere" })).length, 0);
  const page = await reopened.since(0);
  assert.ok(page.events.length >= 30);
  assert.deepEqual(
    page.events.map((e) => e.id),
    Array.from({ length: page.events.length }, (_, i) => i + 1),
  );
  assert.deepEqual((await reopened.since(page.cursor)).events, []);
  for (const rel of [
    "index.json",
    "events.jsonl",
    "topics/study/topic.json",
    "topics/study/reports/" + r.id + ".json",
  ])
    assert.equal((await stat(path.join(root, rel))).mode & 0o777, 0o600);
});
test("journal recovery rolls a partially renamed transaction forward and appends its event only once", async (t) => {
  const root = await temp(t),
    s = await Store.open(root);
  await s.transaction(null, (c) => c.create("topic", fixture));
  const idx = JSON.parse(await readFile(path.join(root, "index.json"), "utf8"));
  const event = {
    id: ++idx.eventSeq,
    type: "test.updated",
    topic_id: "study",
    resource_id: "study",
    timestamp: new Date().toISOString(),
  };
  await writeFile(path.join(root, "staging/index"), JSON.stringify(idx));
  await writeFile(
    path.join(root, "journal.json"),
    JSON.stringify({
      files: [{ temp: "staging/index", target: "index.json" }],
      remove: [],
      events: [event],
    }),
  );
  await rename(path.join(root, "staging/index"), path.join(root, "index.json"));
  const reopened = await Store.open(root);
  assert.deepEqual((await reopened.since(event.id - 1)).events, [event]);
  assert.deepEqual(
    (await (await Store.open(root)).since(event.id - 1)).events,
    [event],
  );
});
test("retention preserves monotonic IDs and signals stale cursors", async (t) => {
  const s = await Store.open(await temp(t));
  await s.transaction(null, (c) => {
    c.create("topic", fixture);
    for (let i = 0; i < 2100; i++) c.emit("topic.updated", "study");
  });
  const p = await s.since(0);
  assert.equal(p.truncated, true);
  assert.equal(p.events.length, 128);
  assert.ok(p.events[0].id > 1000);
  assert.equal((await s.since(p.cursor)).events[0].id, p.cursor + 1);
});
test("storage canonicalizes existing ancestor links while protecting the root and its children", async (t) => {
  const base = await temp(t),
    real = path.join(base, "real"),
    alias = path.join(base, "alias");
  await mkdir(real);
  await symlink(real, alias, "junction");
  for (const relative of ["existing", "new/nested"]) {
    if (relative === "existing") await mkdir(path.join(real, relative));
    const store = await Store.open(path.join(alias, relative));
    assert.equal(store.root, await realpath(path.join(real, relative)));
    assert.deepEqual(await store.list(), []);
    if (relative === "new/nested" && process.platform !== "win32") {
      for (const dir of [store.root, path.dirname(store.root)])
        assert.equal((await stat(dir)).mode & 0o777, 0o700);
    }
    await symlink(real, path.join(store.root, "outside"), "junction");
    await assert.rejects(store.read("outside/anything"), /Unsafe storage path/);
  }
  await assert.rejects(Store.open(alias), /Unsafe storage directory/);
});
test("storage root and file paths reject traversal, symlinks and invalid identifiers", async (t) => {
  const root = await temp(t),
    custom = path.join(root, "custom"),
    ctx = { dataDir: path.join(root, "default") };
  assert.equal(resolveDataDir(ctx, { dataDir: custom }), custom);
  for (const dataDir of ["", "relative", custom + "/../x", null])
    assert.equal(resolveDataDir(ctx, { dataDir }), ctx.dataDir);
  const s = await Store.open(custom);
  await assert.rejects(s.load("../x"));
  await assert.rejects(s.read("../foreign"));
  await mkdir(ctx.dataDir);
  await symlink(ctx.dataDir, path.join(custom, "topics"));
  await assert.rejects(
    s.transaction(null, (c) => c.create("topic", fixture)),
    /Unsafe/,
  );
  await assert.rejects(Store.open(path.join(custom, "topics")));
});
test("512 KiB chunks validate size and replay, support out-of-order upload and stable binary downloads", async (t) => {
  const s = await Store.open(await temp(t)),
    bytes = randomBytes(CHUNK * 2 + 77);
  const { uploadId, totalChunks } = await s.begin(bytes.length);
  assert.equal(totalChunks, 3);
  for (const i of [2, 0, 0])
    await s.upload(
      uploadId,
      i,
      bytes.subarray(i * CHUNK, (i + 1) * CHUNK).toString("base64"),
    );
  await assert.rejects(s.uploaded(uploadId));
  await assert.rejects(
    s.upload(uploadId, 0, Buffer.alloc(CHUNK).toString("base64")),
    /Conflicting/,
  );
  await assert.rejects(s.upload(uploadId, 1, "!"));
  await s.upload(
    uploadId,
    1,
    bytes.subarray(CHUNK, 2 * CHUNK).toString("base64"),
  );
  assert.deepEqual(await s.uploaded(uploadId), bytes);
  const key = await s.cacheDownload(bytes, "council.zip", "application/zip"),
    parts: Buffer[] = [];
  for (let i = 0; i < 3; i++) {
    const page = await s.download(key, i);
    assert.ok(JSON.stringify(page).length < 740000);
    parts.push(Buffer.from(page.base64, "base64"));
  }
  assert.deepEqual(Buffer.concat(parts), bytes);
  await assert.rejects(s.download(key, 3));
  await s.release(key);
  await assert.rejects(s.download(key, 0));
});

test("resource IDs are unique across topic transactions and can be reused after deletion", async (t) => {
  const s = await Store.open(await temp(t));
  await s.transaction(null, (c) => c.create("topic", fixture));
  await assert.rejects(
    s.transaction(null, (c) =>
      c.create("topic", {
        id: "second",
        title: "Second",
        agendas: [{ id: "a", title: "Collision" }],
      }),
    ),
    /already exists/,
  );
  assert.equal((await s.list()).length, 1);
  await s.remove("study");
  await s.transaction(null, (c) =>
    c.create("topic", { id: "a", title: "Reused" }),
  );
  assert.equal((await s.list())[0].id, "a");
});
test("buffered JSON keeps Unicode boundaries and literal object keys", async () => {
  const { jsonBytes, parseJsonBytes } =
    await import("../src/backend/json-bytes.ts");
  const text = ("a".repeat(32767) + "🌳\n好").repeat(40);
  const data = { text, metadata: JSON.parse('{"__proto__":{"literal":true}}') };
  assert.deepEqual(parseJsonBytes(jsonBytes(data)), data);
  assert.equal(jsonBytes(data).toString(), JSON.stringify(data));
});
