import { build, transform } from "esbuild";
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  cp,
  rm,
  rename,
  readdir,
} from "node:fs/promises";
import postcss from "postcss";
import prefix from "postcss-prefix-selector";

async function backend(output) {
  await build({
    entryPoints: ["src/backend/index.mjs"],
    outfile: output + "/backend/index.mjs",
    format: "esm",
    platform: "node",
    target: "node22",
    bundle: true,
  });
}
async function frontend(output) {
  const sources = [
    "style",
    "venue",
    "return-portal",
    "venue-plaque",
    "topic-navigation",
    "discussion",
    "reader",
    "forms",
  ];
  const styles = await Promise.all(
    sources.map((name) => readFile("src/frontend/" + name + ".css", "utf8")),
  );
  const root = ".althing-ext-root";
  const scoped = await postcss([
    prefix({
      prefix: root,
      transform(_prefix, selector, prefixed) {
        if (/^(?:html|body|:root)\b/.test(selector))
          return selector.replace(/^(?:html|body|:root)/, root);
        if (selector.startsWith("[data-theme")) return root + selector;
        return prefixed;
      },
    }),
  ]).process(styles.join("\n"), { from: undefined });
  const css = (await transform(scoped.css, { loader: "css", minify: true }))
    .code;
  const native = (
    await transform(await readFile("src/entries/desktop.css", "utf8"), {
      loader: "css",
      minify: true,
    })
  ).code;
  for (const target of ["page", "web", "desktop"]) {
    const dir = output + "/" + target,
      desktop = target === "desktop";
    await mkdir(dir, { recursive: true });
    await build({
      entryPoints: ["src/entries/" + target + ".tsx"],
      outfile: dir + (desktop ? "/index.js" : "/index.mjs"),
      format: desktop ? "iife" : "esm",
      platform: "browser",
      target: "es2022",
      bundle: true,
      minify: true,
      legalComments: "eof",
      charset: "utf8",
      define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
        __ALTHING_CSS__: JSON.stringify(css),
      },
      plugins:
        target === "web"
          ? [
              {
                name: "shared-page",
                setup(b) {
                  b.onResolve({ filter: /^\.\/page$/ }, () => ({
                    path: "../page/index.mjs",
                    external: true,
                  }));
                },
              },
            ]
          : [],
    });
    await writeFile(dir + "/style.css", desktop ? native : css);
  }
}
async function notices(output) {
  const sections = [];
  for (const name of [
    "react",
    "react-dom",
    "scheduler",
    "lucide-react",
    "dompurify",
    "marked",
    "parse5",
    "entities",
    "zod",
    "@cfworker/json-schema",
    "@streamparser/json",
  ]) {
    const dir = "node_modules/" + name,
      meta = JSON.parse(await readFile(dir + "/package.json", "utf8"));
    const licenses = (await readdir(dir))
      .filter((n) => /^licen[cs]e(\b|$)/i.test(n))
      .sort();
    const texts = await Promise.all(
      licenses.map((n) => readFile(dir + "/" + n, "utf8")),
    );
    sections.push(
      [name + " " + meta.version, meta.license, ...texts].join("\n"),
    );
  }
  await writeFile(
    output + "/assets/third-party-notices.txt",
    sections.join("\n\n"),
  );
}
if (process.argv.includes("--backend-only")) await backend("dist");
else {
  // Build the complete tree before replacing generated output, including any stale entries.
  const stage = await mkdtemp(".althing-build-");
  try {
    await backend(stage);
    await frontend(stage);
    await cp("assets", stage + "/assets", {
      recursive: true,
      filter: (p) => !p.split(/[\\/]/).some((n) => n.startsWith(".")),
    });
    await notices(stage);
    await cp("manifest.json", stage + "/manifest.json");
    await rm("dist", { recursive: true, force: true });
    await rename(stage, "dist");
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
