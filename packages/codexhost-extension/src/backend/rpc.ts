import { z } from "zod";
import { jsonBytes } from "./json-bytes.ts";
import { Store, resolveDataDir, archivePath } from "./storage.ts";
import { CodexHostBridge, modelRef } from "./codexhost-bridge.ts";
import { Orchestrator } from "./orchestrator.ts";
import { Council, hydrate, input } from "./domain/council.ts";
import { id, json, reportHead, type Kind, type Json } from "./domain/models.ts";
import { capabilities } from "./domain/protocols.ts";
import {
  snapshot,
  archiveZip,
  exportStandaloneHtml,
  exportMarkdownBundle,
  restoreArchive,
  inspectArchiveZip,
} from "./domain/archives.ts";

const handlers = [
  "capabilities",
  "codexhost/status",
  "codexhost/projects",
  "codexhost/threads",
  "codexhost/harnesses",
  "codexhost/harness-inspect",
  "topics/list",
  "topics/create",
  "topics/get",
  "topics/update",
  "topics/delete",
  "agendas/create",
  "agendas/update",
  "sub-agendas/create",
  "sub-agendas/update",
  "dispatches/create",
  "contributions/create",
  "contributions/update",
  "reports/publish",
  "reports/get",
  "archives/create",
  "archives/list",
  "archives/download-chunk",
  "exports/download-chunk",
  "archives/import-begin",
  "archives/import-chunk",
  "archives/import-commit",
  "events/since",
  "council/dispatch-round",
  "council/synthesize-sub-agenda",
  "council/conclude-agenda",
  "council/generate-report",
  "council/plan-topic",
  "council/cancel-run",
  "council/retry-run",
  "council/runs",
  "transfers/release",
] as const;
export const methods = [...handlers, "operations/get"].map(
  (m) => "althing/" + m,
);
const configs = z
  .object({
    harnessId: z.string().min(1),
    model: z.union([z.string(), modelRef]).nullable().optional(),
    thinking: z.string().optional(),
    threadId: z.string().nullable().optional(),
  })
  .strict();
const hostConfig = z
  .object({
    project_cwd: z.string().optional(),
    project_label: z.string().optional(),
    panelist_threads: z.record(id, configs).optional(),
    moderator_config: configs.nullable().optional(),
  })
  .strict();
function metadata(value: unknown, existing?: Json) {
  const data = z.record(json).parse(value),
    previous = existing ? input(existing) : {};
  if (data.codexhost !== undefined) {
    const host = hostConfig.parse(data.codexhost);
    data.codexhost = json.parse({
      ...previous,
      ...host,
      runs: previous.runs ?? [],
    });
  } else if (existing) data.codexhost = existing;
  return data;
}
const index = z.number().int().nonnegative().default(0);
const groups: Record<string, { kind: Kind; key: string; parent: string }> = {
  agendas: { kind: "agenda", key: "agendaId", parent: "topicId" },
  "sub-agendas": { kind: "sub_agenda", key: "subAgendaId", parent: "agendaId" },
  dispatches: { kind: "dispatch", key: "dispatchId", parent: "subAgendaId" },
  contributions: {
    kind: "contribution",
    key: "contributionId",
    parent: "subAgendaId",
  },
  reports: { kind: "report", key: "reportId", parent: "topicId" },
};
export async function engine(
  dataDir: string,
  settings: Record<string, unknown>,
) {
  const store = await Store.open(resolveDataDir({ dataDir }, settings)),
    bridge = new CodexHostBridge({ dataDir }, settings);
  const council = new Orchestrator(store, bridge);
  await council.resume();
  async function invoke(method: string, params: unknown): Promise<unknown> {
    const p = input(params ?? {}),
      tid = () => id.parse(p.topicId),
      chunk = () => index.parse(p.chunkIndex);
    switch (method) {
      case "capabilities":
        return capabilities(methods);
      case "codexhost/status":
        return bridge.getStatus();
      case "codexhost/projects":
        return bridge.workspaces(
          z
            .object({
              query: z.string().optional(),
              limit: z.number().int().positive().optional(),
              offset: index.optional(),
              refresh: z.boolean().optional(),
            })
            .strict()
            .parse(p),
        );
      case "codexhost/threads":
        return bridge.listThreads(
          z
            .object({
              limit: z.number().int().positive().max(100).optional(),
              cwd: z.string().optional(),
            })
            .strict()
            .parse(p),
        );
      case "codexhost/harnesses":
        return bridge.listHarnesses();
      case "codexhost/harness-inspect":
        return bridge.inspectHarness(
          z.string().min(1).parse(p.harnessId),
          z.string().optional().parse(p.cwd),
          z.boolean().optional().parse(p.refresh),
        );
      case "topics/list":
        return store.list(
          z
            .object({
              status: z.string().optional(),
              q: z.string().optional(),
              tag: z.string().optional(),
              projectCwd: z.string().optional(),
            })
            .strict()
            .parse(p),
        );
      case "topics/create":
        return store.transaction(null, (c) => {
          const data = { ...input(p.data ?? p) };
          data.protocol_id ??= settings.defaultProtocol ?? "council-standard";
          if (data.metadata) data.metadata = metadata(data.metadata);
          c.create("topic", data);
          return hydrate(c.tree);
        });
      case "topics/get":
        return store.serial(async () => hydrate(await store.load(tid())));
      case "topics/update":
        return store.transaction(tid(), (c) => {
          const data = { ...input(p.patch ?? p.data) };
          if (data.metadata !== undefined)
            data.metadata = metadata(data.metadata, c.tree.metadata.codexhost);
          c.patch("topic", tid(), data);
          return hydrate(c.tree);
        });
      case "topics/delete":
        return store.remove(tid());
      case "reports/get":
        return store.serial(() => store.report(tid(), id.parse(p.reportId)));
      case "archives/create":
        return store.transaction(tid(), (c, files) =>
          snapshot(store, c, files, z.record(json).parse(p.metadata ?? {})),
        );
      case "archives/list":
        return store.serial(async () => (await store.load(tid())).archives);
      case "archives/download-chunk":
        return store.chunk(
          archivePath(tid(), id.parse(p.archiveId)),
          chunk(),
          id.parse(p.archiveId) + ".zip",
          "application/zip",
        );
      case "exports/download-chunk": {
        if (p.downloadId)
          return store.download(id.parse(p.downloadId), chunk());
        if (chunk() !== 0) throw Error("Use the downloadId from chunk zero");
        const format = z
          .enum(["standalone-html", "markdown-bundle", "archive-zip"])
          .parse(p.format);
        const t = await store.serial(async () =>
          hydrate(await store.full(await store.load(tid())), true),
        );
        const bytes =
          format === "standalone-html"
            ? exportStandaloneHtml(t)
            : format === "markdown-bundle"
              ? exportMarkdownBundle(t)
              : archiveZip(t);
        const key = await store.cacheDownload(
          bytes,
          t.id + (format === "standalone-html" ? ".html" : ".zip"),
          format === "standalone-html" ? "text/html" : "application/zip",
        );
        return store.download(key, 0);
      }
      case "archives/import-begin":
        return store.begin(z.number().int().parse(p.totalBytes));
      case "archives/import-chunk":
        return store.upload(
          id.parse(p.uploadId),
          chunk(),
          z.string().parse(p.base64),
        );
      case "archives/import-commit": {
        const key = id.parse(p.uploadId),
          receipt = await store.serial(() => store.receipt(key));
        if (receipt) return receipt;
        const tree = inspectArchiveZip(await store.uploaded(key), true);
        return { topicId: await restoreArchive(store, tree, key) };
      }
      case "transfers/release":
        return store.serial(() => store.release(id.parse(p.transferId)));
      case "events/since":
        return store.since(
          index.parse(p.cursor),
          id.optional().parse(p.topicId),
        );
      case "council/dispatch-round":
        return council.dispatchRound(tid(), id.parse(p.subAgendaId), p);
      case "council/synthesize-sub-agenda":
        return council.moderate("synthesis", tid(), p);
      case "council/conclude-agenda":
        return council.moderate("agenda_conclusion", tid(), p);
      case "council/generate-report":
        return council.moderate("report", tid(), p);
      case "council/plan-topic":
        return council.moderate("plan", tid(), p);
      case "council/cancel-run":
        return council.cancel(tid(), id.parse(p.runId));
      case "council/retry-run":
        return council.retry(tid(), id.parse(p.runId));
      case "council/runs":
        return council.runs(tid());
    }
    const [group, action] = method.split("/"),
      spec = groups[group];
    if (!spec || !["create", "publish", "update"].includes(action))
      throw Error("Unknown RPC method");
    return store.transaction(tid(), (c) => {
      const r =
        action === "update"
          ? c.patch(spec.kind, id.parse(p[spec.key]), p.patch ?? p.data)
          : c.create(spec.kind, p.data, id.parse(p[spec.parent]));
      if (spec.kind === "report") return reportHead(c.get("report", r.id));
      if (spec.kind === "contribution" || spec.kind === "dispatch") return r;
      const tree = hydrate(c.tree);
      return spec.kind === "agenda"
        ? tree.agendas.find((a) => a.id === r.id)
        : tree.agendas.flatMap((a) => a.sub_agendas).find((s) => s.id === r.id);
    });
  }
  return {
    dispose: () => council.dispose(),
    async call(method: string, params: unknown) {
      const value = await invoke(method, params),
        bytes = jsonBytes(value);
      if (bytes.length > 1500 * 1024) {
        const downloadId = await store.cacheDownload(
          bytes,
          "response.json",
          "application/json",
        );
        return { downloadId, encoding: "json", totalBytes: bytes.length };
      }
      return value;
    },
  };
}
