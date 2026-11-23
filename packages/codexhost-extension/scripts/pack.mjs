import { readFile, writeFile, mkdir, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { writeZip } from "../src/backend/domain/zip.ts";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const out = "dist-release",
  members = new Map();
async function walk(relative = "") {
  for (const name of (await readdir(path.join("dist", relative))).sort()) {
    if (
      name.startsWith(".") ||
      name === "__MACOSX" ||
      name === "Thumbs.db" ||
      name === "desktop.ini"
    )
      continue;
    const key = path.posix.join(relative, name),
      file = path.join("dist", key),
      info = await lstat(file);
    if (info.isDirectory()) await walk(key);
    else if (info.isFile()) members.set(key, await readFile(file));
    else throw Error("Unexpected release file: " + key);
  }
}
await walk();
const manifest = JSON.parse(members.get("manifest.json"));
const declared = [
  manifest.page.entry,
  manifest.page.style,
  manifest.web.entry,
  manifest.web.style,
  manifest.desktop.script,
  manifest.desktop.style,
  manifest.backend.entry,
  manifest.icon,
  ...(manifest.screenshots || []),
];
for (const member of declared)
  if (!members.has(member))
    throw Error("Missing " + member + ". Run npm run build before packing.");
const zip = manifest.id + ".zip",
  files = new Map([[zip, writeZip(members)]]);
for (const image of [manifest.icon, ...(manifest.screenshots ?? [])].filter(
  Boolean,
))
  files.set(path.basename(image), members.get(image));
files.set(
  "sources-" + manifest.id + ".json",
  Buffer.from(
    JSON.stringify(
      {
        id: manifest.id,
        repository: manifest.repository,
        trustTier: "community",
        asset: zip,
      },
      null,
      2,
    ) + "\n",
  ),
);
await mkdir(out, { recursive: true });
for (const [name, bytes] of files) await writeFile(path.join(out, name), bytes);
await writeFile(
  path.join(out, "SHA256SUMS.txt"),
  [...files].map(([name, b]) => digest(b) + "  " + name).join("\n") + "\n",
);
console.log(
  zip + " (" + files.get(zip).length + " bytes, " + members.size + " members)",
);
