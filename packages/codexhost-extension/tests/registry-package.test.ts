import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat, writeFile, cp } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { validateRelease } from "../scripts/validate-registry.mjs";
import { readZip, writeZip } from "../src/backend/domain/zip";
import { temp } from "./helpers";
test("release passes the pinned marketplace validator, matches dist and links both renderer entries", async () => {
  const report = await validateRelease(),
    zip = await readFile("dist-release/the-althing.zip"),
    files = readZip(zip);
  assert.equal(report.members, files.size);
  assert.equal(zip.length < 64 * 1024 * 1024, true);
  assert.match(report.sha256!, /^[a-f0-9]{64}$/);
  assert.ok(
    ![...files.keys()].some((p) => p.split("/").some((s) => s.startsWith("."))),
  );
  const m = JSON.parse(files.get("manifest.json")!.toString());
  assert.equal(m.name["zh-CN"], "议事厅");
  assert.equal(m.slots, undefined);
  assert.deepEqual(files.get(m.icon), await readFile("dist-release/icon.png"));
  for (const input of [
    m.backend.entry,
    m.page.entry,
    m.web.entry,
    m.desktop.script,
  ])
    assert.ok((await stat("dist/" + input)).size < 2 * 1024 * 1024);
  for (const style of [m.page.style, m.web.style, m.desktop.style])
    assert.ok(files.get(style)!.length <= 256 * 1024);
  for (const [name, bytes] of files)
    if (name.endsWith(".webp")) {
      assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
      assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
    }
});
test("the four marketplace screenshots ship byte-for-byte in the release and checksum list", async () => {
  const files = readZip(await readFile("dist-release/the-althing.zip"));
  const manifest = JSON.parse(files.get("manifest.json")!.toString());
  const names = [
    "hub.webp",
    "venue-lobby.webp",
    "venue-roundtable.webp",
    "report-reader.webp",
  ];
  assert.deepEqual(
    manifest.screenshots,
    names.map((name) => "assets/screenshots/" + name),
  );
  const sums = (await readFile("dist-release/SHA256SUMS.txt", "utf8"))
    .trimEnd()
    .split("\n");
  for (const name of names) {
    const path = "assets/screenshots/" + name,
      screenshot = await readFile(path);
    assert.equal(screenshot.toString("ascii", 0, 4), "RIFF");
    assert.equal(screenshot.toString("ascii", 8, 12), "WEBP");
    assert.ok(screenshot.length <= 512 * 1024);
    assert.deepEqual(files.get(path), screenshot);
    assert.deepEqual(await readFile(join("dist-release", name)), screenshot);
    assert.ok(
      sums.includes(
        createHash("sha256").update(screenshot).digest("hex") + "  " + name,
      ),
    );
  }
});
test("invalid releases fail for a flagged script, bare module and dynamic import even with matching checksums", async (t) => {
  const dir = await temp(t),
    release = join(dir, "release"),
    dist = join(dir, "dist");
  await cp("dist-release", release, { recursive: true });
  await cp("dist", dist, { recursive: true });
  const files = readZip(await readFile(join(release, "the-althing.zip"))),
    sums = await readFile(join(release, "SHA256SUMS.txt"), "utf8");
  for (const [source, error] of [
    ["// " + ["child", "process"].join("_"), /Static scan flagged/],
    ['import "bare";', /Unsupported module import/],
    ['export const run=()=>import("../page/index.mjs")', /Dynamic import/],
  ] as const) {
    const name = "web/index.mjs",
      code = Buffer.from(source);
    files.set(name, code);
    await writeFile(join(dist, name), code);
    const bytes = writeZip(files),
      hash = createHash("sha256").update(bytes).digest("hex");
    await writeFile(join(release, "the-althing.zip"), bytes);
    await writeFile(
      join(release, "SHA256SUMS.txt"),
      sums.replace(/^[a-f0-9]{64}(?=  the-althing\.zip)/m, hash),
    );
    await assert.rejects(validateRelease(release, dist), error);
  }
});
