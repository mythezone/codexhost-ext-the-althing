import { createHash } from "node:crypto";
import { Council, hydrate, validateDependencies, input } from "./council.ts";
import {
  topicTreeSchema,
  fields,
  now,
  uid,
  id,
  type Archive,
  type Topic,
  type Kind,
  type Json,
} from "./models.ts";
import { offlineView, publicationHtml } from "./rendering.ts";
import { readZip, writeZip } from "./zip.ts";
import { archivePath, type Store, type Files } from "../storage.ts";

export const sha256 = (b: Buffer) =>
  createHash("sha256").update(b).digest("hex");
import { jsonBytes, parseJsonBytes } from "../json-bytes.ts";
export function archiveZip(t: Topic, locale = "en") {
  const files = new Map<string, Buffer>([
    ["topic.json", jsonBytes(t)],
    ["index.html", Buffer.from(offlineView(t, { locale }))],
    [
      "README.md",
      Buffer.from(
        "# The Althing\n\nExtract this folder and open index.html locally. Reports are in reports/.\nImport the original ZIP to restore this council on another Althing server.\n",
      ),
    ],
  ]);
  for (const r of t.reports)
    files.set(
      "reports/" + id.parse(r.id) + ".html",
      Buffer.from(publicationHtml(r, locale)),
    );
  files.set(
    "manifest.json",
    jsonBytes({
      format: "althing-archive",
      version: "1.0",
      topic_id: t.id,
      created_at: now(),
      files: Object.fromEntries(
        [...files].map(([name, bytes]) => [name, sha256(bytes)]),
      ),
    }),
  );
  return writeZip(files);
}
export const exportStandaloneHtml = (t: Topic, locale?: string) =>
  Buffer.from(offlineView(t, { embedReports: true, locale }));
export function exportMarkdownBundle(t: Topic) {
  const files = new Map([
    [
      "topic.md",
      Buffer.from(
        "# " + t.title + "\n\n" + t.description + "\n\n" + t.executive_summary,
      ),
    ],
  ]);
  for (const a of t.agendas) {
    const body = [a.objective, a.conclusion_summary];
    for (const s of a.sub_agendas) {
      body.push(
        "## " + s.title,
        s.prompt_framing,
        ...s.dispatches.map((d) => d.prompt_full),
      );
      for (const c of s.contributions)
        body.push("### " + c.panelist_name, c.summary, c.full_content);
      body.push(s.synthesis_summary);
    }
    files.set(
      "agendas/" + a.id + ".md",
      Buffer.from("# " + a.title + "\n\n" + body.join("\n\n")),
    );
  }
  for (const r of t.reports)
    files.set(
      "reports/" + r.id + (r.markdown_content ? ".md" : ".html"),
      Buffer.from(r.markdown_content || r.html_content!),
    );
  return writeZip(files);
}
export function inspectArchiveZip(blob: Buffer, forRestore = false): Topic {
  const files = readZip(blob);
  const decode = (name: string) =>
    parseJsonBytes(files.get(name) ?? Buffer.alloc(0));
  const m = decode("manifest.json");
  if (
    m?.format !== "althing-archive" ||
    m.version !== "1.0" ||
    typeof m.created_at !== "string" ||
    !m.files
  )
    throw Error("Invalid archive manifest");
  for (const [name, b] of files)
    if (name !== "manifest.json" && sha256(b) !== m.files[name])
      throw Error("Archive checksum mismatch");
  const t: Topic = decode("topic.json"),
    validation = topicTreeSchema.validate(t);
  if (!validation.valid)
    throw Error(
      "Invalid topic in archive: " + validation.errors[0]?.instanceLocation,
    );
  const required = new Set([
    "topic.json",
    "index.html",
    "README.md",
    ...t.reports.map((r) => "reports/" + id.parse(r.id) + ".html"),
  ]);
  if (
    m.topic_id !== t.id ||
    required.size + 1 !== files.size ||
    Object.keys(m.files).length !== required.size ||
    [...required].some(
      (name) => !files.has(name) || !Object.hasOwn(m.files, name),
    )
  )
    throw Error("Archive manifest does not match topic");
  if (forRestore) {
    // Restore regenerates publications and dispatch reply lists from their canonical sources.
    for (const r of t.reports)
      if (r.format === "markdown" || r.source_html) delete r.html_content;
    for (const a of t.agendas)
      for (const s of a.sub_agendas)
        for (const d of s.dispatches) d.contributions = [];
  }
  return t;
}
export async function snapshot(
  store: Store,
  c: Council,
  files: Files,
  metadata: Record<string, Json> = {},
  locale?: string,
) {
  const t = hydrate(await store.full(c.tree), true),
    blob = archiveZip(t, locale),
    aid = uid();
  const row: Archive = {
    id: aid,
    topic_id: t.id,
    title: t.title,
    format: "zip",
    file_name: aid + ".zip",
    file_size_bytes: blob.length,
    sha256: sha256(blob),
    created_at: now(),
    metadata,
    download_url: "/api/v1/archives/" + aid + "/download",
    preview_url: "/api/v1/archives/" + aid + "/preview",
  };
  files.set(archivePath(t.id, aid), blob);
  c.tree.archives.push(row);
  c.emit("archive.created", aid);
  return row;
}
export function restoreArchive(
  store: Store,
  t: Topic,
  uploadId?: string,
  locale = "en",
) {
  return store
    .transaction(null, async (c, files) => {
      c.reportLocale = locale;
      if (uploadId) {
        const previous = await store.receipt(uploadId);
        if (previous) {
          // Receipts are committed with the restored tree. Check again inside the write queue.
          throw new AlreadyRestored(previous.topicId);
        }
      }
      type Entry = {
        kind: Kind;
        old: Record<string, unknown>;
        parent?: string;
      };
      const entries: Entry[] = [{ kind: "topic", old: t }];
      for (const a of t.agendas) {
        if (a.topic_id !== t.id) throw Error("Invalid agenda owner");
        entries.push({ kind: "agenda", old: a, parent: t.id });
        for (const s of a.sub_agendas) {
          if (s.topic_id !== t.id || s.agenda_id !== a.id)
            throw Error("Invalid sub-agenda owner");
          entries.push({ kind: "sub_agenda", old: s, parent: a.id });
          for (const [kind, children] of [
            ["dispatch", s.dispatches],
            ["contribution", s.contributions],
          ] as const)
            for (const child of children) {
              if (
                child.topic_id !== t.id ||
                child.agenda_id !== a.id ||
                child.sub_agenda_id !== s.id
              )
                throw Error("Invalid discussion owner");
              entries.push({ kind, old: child, parent: s.id });
            }
        }
      }
      for (const r of t.reports) {
        if (r.topic_id !== t.id) throw Error("Invalid report owner");
        entries.push({ kind: "report", old: r, parent: t.id });
      }
      const ids = new Map(entries.map(({ old }) => [id.parse(old.id), uid()]));
      if (ids.size !== entries.length)
        throw Error("Duplicate resource in archive");
      const remap = (k: unknown) => {
        const v = ids.get(id.parse(k));
        if (!v) throw Error("Dangling archive reference");
        return v;
      };
      for (const { kind, old, parent } of entries) {
        const data = Object.fromEntries(
          Object.keys(fields[kind])
            .filter((k) => Object.hasOwn(old, k))
            .map((k) => [k, old[k]]),
        );
        for (const key of [
          "agendas",
          "sub_agendas",
          "depends_on",
          "target_contribution_ids",
          "final_report_id",
          "report_id",
        ])
          delete data[key];
        data.id = remap(old.id);
        for (const k of ["dispatch_id", "agenda_id"])
          if (data[k]) data[k] = remap(data[k]);
        if (
          Array.isArray(old.pinned_fields) &&
          ["agenda", "topic"].includes(kind)
        ) {
          for (const k of [
            "current_activity",
            "progress_pct",
            ...(kind === "agenda" ? ["status"] : []),
          ])
            if (!old.pinned_fields.includes(k)) delete data[k];
        }
        if (kind === "topic") {
          data.status = "archived";
          // A portable council is a historical record. Imported Host thread handles must never resume local work.
          const metadata = { ...input(data.metadata ?? {}) };
          if (metadata.codexhost) {
            const host = input(metadata.codexhost);
            const threads = input(host.panelist_threads ?? {});
            const runs = Array.isArray(host.runs)
              ? host.runs.map((source) => {
                  const run = { ...input(source) };
                  for (const field of [
                    "topicId",
                    "agendaId",
                    "subAgendaId",
                    "dispatchId",
                    "contributionId",
                    "reportId",
                  ])
                    if (run[field]) run[field] = remap(run[field]);
                  if (Array.isArray(run.targetContributionIds))
                    run.targetContributionIds =
                      run.targetContributionIds.map(remap);
                  if (run.status === "queued" || run.status === "running") {
                    run.archivedStatus = run.status;
                    run.status = "cancelled";
                    run.finishedAt = now();
                    run.updatedAt = run.finishedAt;
                    run.error = "Archived before completion on the source Host";
                  }
                  return run;
                })
              : [];
            metadata.codexhost = {
              ...host,
              runs,
              panelist_threads: Object.fromEntries(
                Object.entries(threads).map(([key, value]) => {
                  const cfg = input(value);
                  return [
                    key,
                    {
                      ...cfg,
                      ...(cfg.threadId
                        ? { archivedThreadId: cfg.threadId }
                        : {}),
                      threadId: null,
                    },
                  ];
                }),
              ),
            };
          }
          data.metadata = metadata;
        }
        if (kind === "report") {
          data.set_as_primary = false;
          data.html_content =
            old.format === "markdown"
              ? ""
              : (old.source_html ?? old.html_content);
        }
        c.create(kind, data, parent ? remap(parent) : undefined, false);
      }
      for (const { kind, old } of entries) {
        const row = c.get(kind, remap(old.id));
        for (const k of ["final_report_id", "report_id"])
          if (old[k]) Reflect.set(row, k, remap(old[k]));
        for (const k of ["target_contribution_ids", "depends_on"])
          if (Array.isArray(old[k])) Reflect.set(row, k, old[k].map(remap));
        c.references(kind, row);
      }
      validateDependencies(c.tree);
      c.rollup();
      for (const { kind, old } of entries) {
        const row = c.get(kind, remap(old.id));
        for (const k of ["created_at", "updated_at", "completed_at"])
          if (old[k]) Reflect.set(row, k, old[k]);
      }
      await snapshot(store, c, files, { restored_from: t.id }, locale);
      if (uploadId)
        files.set(
          store.receiptPath(uploadId),
          JSON.stringify({ topicId: c.tree.id }),
        );
      return c.tree.id;
    })
    .catch((e) => {
      if (e instanceof AlreadyRestored) return e.topicId;
      throw e;
    });
}
class AlreadyRestored extends Error {
  constructor(readonly topicId: string) {
    super("Upload was already restored");
  }
}
