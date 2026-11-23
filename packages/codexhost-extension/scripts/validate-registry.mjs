import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { buildCatalog } from "codexhost-extensions-registry/validate-and-build-catalog.mjs";
import { readDesktopExtensionZip } from "codexhost-extensions-registry/runtime.mjs";
import { init, parse } from "es-module-lexer";
import { rollup } from "@rollup/browser";

export async function validateRelease(
  directory = "dist-release",
  dist = "dist",
) {
  const read = (name) => readFile(path.join(directory, name));
  const sourcePath = path.resolve(directory, "sources-the-althing.json"),
    source = JSON.parse(await readFile(sourcePath));
  const checksums = new Map(
    (await read("SHA256SUMS.txt"))
      .toString()
      .trim()
      .split("\n")
      .map((line) => line.split("  ").reverse()),
  );
  for (const [name, hash] of checksums) {
    if (
      name !== path.basename(name) ||
      createHash("sha256")
        .update(await read(name))
        .digest("hex") !== hash
    )
      throw Error("Checksum mismatch: " + name);
  }
  const files = readDesktopExtensionZip(await read(source.asset)),
    manifest = JSON.parse(files.get("manifest.json"));
  for (const [name, bytes] of files)
    if (!bytes.equals(await readFile(path.join(dist, name))))
      throw Error("Rebuild package: " + name);
  const prefix =
    source.repository + "/releases/download/v" + manifest.version + "/";
  const names = [
    source.asset,
    ...[manifest.icon, ...(manifest.screenshots || [])]
      .filter(Boolean)
      .map((p) => path.basename(p)),
  ];
  const metadata = {
    published_at: "2000-01-01T00:00:00Z",
    draft: false,
    prerelease: false,
    assets: names.map((name) => ({
      name,
      browser_download_url: prefix + name,
      digest: "sha256:" + checksums.get(name),
    })),
  };
  const temp = await mkdtemp(path.join(tmpdir(), "althing-registry-")),
    original = globalThis.fetch;
  try {
    // Supply the prospective release to the upstream catalog builder before publication.
    const api = source.repository.replace(
      "https://github.com/",
      "https://api.github.com/repos/",
    );
    globalThis.fetch = async (url) => {
      const key = String(url);
      if (key === api + "/releases/latest") return Response.json(metadata);
      if (key === api) return Response.json({ stargazers_count: 0 });
      const name = names.find((n) => prefix + n === key);
      if (!name) throw Error("Unexpected registry request: " + key);
      return new Response(await read(name));
    };
    const report = await buildCatalog({
      sourcesPath: sourcePath,
      directory: pathToFileURL(temp + path.sep),
      checkOnly: true,
    });
    if (report.failed) throw Error(report.markdown);
  } finally {
    globalThis.fetch = original;
    await rm(temp, { recursive: true, force: true });
  }
  await init;
  // Browser Rollup loads its bundled parser via fetch. Node needs a file URL adapter.
  const wasm = new URL(
    "bindings_wasm_bg.wasm",
    import.meta.resolve("@rollup/browser"),
  );
  globalThis.fetch = async (url) => {
    if (String(url) !== wasm.href)
      throw Error("Unexpected module request: " + url);
    return new Response(await readFile(wasm), {
      headers: { "content-type": "application/wasm" },
    });
  };
  try {
    for (const input of [manifest.page.entry, manifest.web.entry]) {
      const bundle = await rollup({
        input,
        treeshake: false,
        onwarn(w) {
          throw Error(w.message);
        },
        plugins: [
          {
            name: "host-package",
            resolveId(id, importer) {
              if (!importer) return id;
              if (!/^\.\.?\//.test(id) || /[\\%?#]/.test(id))
                throw Error("Unsupported module import: " + id);
              const resolved = path.posix.join(
                path.posix.dirname(importer),
                id,
              );
              if (
                !resolved.endsWith(".mjs") ||
                resolved.startsWith("../") ||
                !files.has(resolved) ||
                resolved === manifest.backend.entry
              )
                throw Error("Invalid renderer module: " + resolved);
              return resolved;
            },
            load(id) {
              const code = files.get(id).toString();
              if (parse(code)[0].some((i) => i.type === "dynamic"))
                throw Error("Dynamic import in " + id);
              return code;
            },
          },
        ],
      });
      try {
        const { output } = await bundle.generate({
          format: "system",
          compact: true,
        });
        if (
          output.length !== 1 ||
          output[0].imports.length ||
          output[0].dynamicImports.length
        )
          throw Error("Renderer graph needs an external dependency");
      } finally {
        await bundle.close();
      }
    }
  } finally {
    globalThis.fetch = original;
  }
  return { members: files.size, sha256: checksums.get(source.asset) };
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const r = await validateRelease();
  console.log(
    "Registry validation passed; renderer modules linked. " +
      r.members +
      " members, SHA-256 " +
      r.sha256,
  );
}
