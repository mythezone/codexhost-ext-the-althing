import { resolveLocale } from "../shared/i18n.ts";
import { splitPrompt, type CouncilProtocolId } from "../shared/command.ts";
import { publicationHtml } from "./domain/rendering.ts";
import { sameAssignment } from "../shared/agents.ts";
import { recommendPanel } from "./smart-panel.ts";
import path from "node:path";
import { z } from "zod";
import { jsonBytes } from "./json-bytes.ts";
import { Store, resolveDataDir, archivePath } from "./storage.ts";
import { CodexHostBridge, modelRef } from "./codexhost-bridge.ts";
import { Orchestrator } from "./orchestrator.ts";
import { Council, hydrate, topicSummary, input } from "./domain/council.ts";
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
  "codexhost/agents",
  "codexhost/harnesses",
  "codexhost/harness-inspect",
  "topics/list",
  "topics/create",
  "topics/get",
  "topics/body",
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
  "council/recommend-panel",
  "council/convene",
  "council/set-auto-dispatch",
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
    moderator_display: z
      .object({ role: z.string(), reasoning_effort: z.string() })
      .nullable()
      .optional(),
    auto_dispatch: z.boolean().optional(),
    auto_assign_roles: z.boolean().optional(),
  })
  .strict();
function metadata(value: unknown, existing?: Json) {
  const data = z.record(json).parse(value),
    previous = existing ? input(existing) : {};
  if (data.codexhost !== undefined) {
    const host = hostConfig.parse(data.codexhost);
    if (existing) {
      const keepThread = (next: z.infer<typeof configs>, old: unknown) => {
        const prior = configs.safeParse(old);
        if (prior.success && sameAssignment(prior.data, next))
          return { ...prior.data, threadId: prior.data.threadId ?? null };
        return { ...next, threadId: null };
      };
      if (host.panelist_threads) {
        const previousSeats = input(previous.panelist_threads ?? {});
        host.panelist_threads = Object.fromEntries(
          Object.entries(host.panelist_threads).map(([id, next]) => [
            id,
            keepThread(next, previousSeats[id]),
          ]),
        );
      }
      if (host.moderator_config)
        host.moderator_config = keepThread(
          host.moderator_config,
          previous.moderator_config,
        );
    }
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
    const locale = resolveLocale(p.locale ?? settings.language);
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
      case "codexhost/agents": {
        const { cwd, refresh } = z
          .object({
            cwd: z.string().optional(),
            refresh: z.boolean().optional(),
          })
          .strict()
          .parse(p);
        return bridge.listAgents(cwd, refresh);
      }
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
        return store.serial(async () => {
          const summaryOnly = z.boolean().optional().parse(p.summaryOnly);
          const tree = await store.load(tid());
          return summaryOnly ? topicSummary(tree) : hydrate(tree);
        });
      case "topics/body": {
        const kind = z.enum(["contribution", "dispatch"]).parse(p.kind);
        const resourceId = id.parse(p.resourceId);
        return store.serial(async () => {
          const council = new Council(await store.load(tid()));
          const row = council.get(kind, resourceId);
          if (row.topic_id !== council.tree.id)
            throw Error("Unknown resource in this topic");
          return {
            text: "full_content" in row ? row.full_content : row.prompt_full,
          };
        });
      }
      case "topics/update":
        return store.transaction(tid(), (c) => {
          const data = { ...input(p.patch ?? p.data) };
          if (data.metadata !== undefined)
            data.metadata = {
              ...c.tree.metadata,
              ...metadata(data.metadata, c.tree.metadata.codexhost),
            };
          if (
            c.tree.status === "archived" &&
            (data.panelists || data.moderator)
          )
            throw Error("Archived council roles are read-only");
          c.patch("topic", tid(), data);
          return hydrate(c.tree);
        });
      case "topics/delete":
        return store.remove(tid());
      case "reports/get":
        return store.serial(async () => {
          const r = await store.report(tid(), id.parse(p.reportId));
          if (!p.locale) return r;
          return { ...r, html_content: publicationHtml(r, locale) };
        });
      case "archives/create":
        return store.transaction(tid(), (c, files) =>
          snapshot(
            store,
            c,
            files,
            z.record(json).parse(p.metadata ?? {}),
            locale,
          ),
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
            ? exportStandaloneHtml(t, locale)
            : format === "markdown-bundle"
              ? exportMarkdownBundle(t)
              : archiveZip(t, locale);
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
        return { topicId: await restoreArchive(store, tree, key, locale) };
      }
      case "transfers/release":
        return store.serial(() => store.release(id.parse(p.transferId)));
      case "events/since":
        return store.since(
          index.parse(p.cursor),
          id.optional().parse(p.topicId),
        );
      case "council/dispatch-round":
        return council.dispatchRound(tid(), id.parse(p.subAgendaId), { ...p, locale });
      case "council/synthesize-sub-agenda":
        return council.moderate("synthesis", tid(), { ...p, locale });
      case "council/conclude-agenda":
        return council.moderate("agenda_conclusion", tid(), { ...p, locale });
      case "council/generate-report":
        return council.moderate("report", tid(), { ...p, locale });
      case "council/plan-topic":
        return council.moderate("plan", tid(), { ...p, locale });
      case "council/recommend-panel": {
        const req = z
          .object({
            prompt: z.string().optional(),
            cwd: z.string().optional(),
            protocol: z
              .enum(["council-standard", "adversarial-debate", "rapid-panel"])
              .optional(),
            expertCount: z.number().int().min(1).max(6).optional(),
            locale: z.string().optional(),
          })
          .strict()
          .parse(p);
        let workspace = req.cwd?.trim() || "";
        let workspaceLabel = "";
        if (!workspace || !path.isAbsolute(workspace)) {
          try {
            const found = await bridge.workspaces({ limit: 20 });
            const first = found.projects[0] as
              | { cwd?: string; name?: string }
              | undefined;
            if (first?.cwd && path.isAbsolute(first.cwd)) {
              workspace = first.cwd;
              workspaceLabel = String(first.name || "");
            }
          } catch {
            // Allow graceful offline preview without crashing.
          }
        }
        if (workspace && !workspaceLabel) {
          workspaceLabel =
            workspace.split(/[\\/]/).filter(Boolean).pop() || workspace;
        }
        const agents = await bridge
          .listAgents(workspace || undefined)
          .then((r) => r.agents)
          .catch(() => []);
        const defaultProtocol = (
          ["council-standard", "adversarial-debate", "rapid-panel"].includes(
            String(settings.defaultProtocol),
          )
            ? settings.defaultProtocol
            : "council-standard"
        ) as CouncilProtocolId;
        return recommendPanel({
          prompt: req.prompt,
          agents,
          workspace,
          workspaceLabel,
          protocol: req.protocol,
          defaultProtocol,
          expertCount: req.expertCount,
          locale,
        });
      }
      case "council/convene": {
        const req = z
          .object({
            prompt: z.string().optional(),
            title: z.string().optional(),
            subtitle: z.string().optional(),
            description: z.string().optional(),
            domain_tags: z.array(z.string()).optional(),
            cwd: z.string().optional(),
            protocol: z
              .enum(["council-standard", "adversarial-debate", "rapid-panel"])
              .optional(),
            expertCount: z.number().int().min(1).max(6).optional(),
            autoDispatch: z.boolean().optional(),
            planWithAi: z.boolean().optional(),
            planningPrompt: z.string().optional(),
            locale: z.string().optional(),
            panelists: z.array(z.record(z.unknown())).optional(),
            moderator: z.record(z.unknown()).optional(),
            host: z.record(z.unknown()).optional(),
            agendas: z.array(z.record(z.unknown())).optional(),
          })
          .strict()
          .parse(p);
        const promptText = (req.prompt ?? "").trim();
        const split = splitPrompt(promptText);
        const title = (req.title?.trim() || split.title).trim();
        if (!title) throw Error("Council title or prompt is required.");
        const description =
          req.description !== undefined ? req.description : split.description;

        let workspace = req.cwd?.trim() || "";
        let workspaceLabel = "";
        const projects = await bridge
          .workspaces({ limit: 50 })
          .then((r) => r.projects as { cwd?: string; name?: string }[])
          .catch(() => []);
        if (workspace && path.isAbsolute(workspace)) {
          workspaceLabel =
            projects.find((item) => item.cwd === workspace)?.name ||
            workspace.split(/[\\/]/).filter(Boolean).pop() ||
            workspace;
        } else {
          const first = projects.find(
            (item) => typeof item.cwd === "string" && path.isAbsolute(item.cwd),
          );
          if (first?.cwd) {
            workspace = first.cwd;
            workspaceLabel =
              first.name ||
              workspace.split(/[\\/]/).filter(Boolean).pop() ||
              workspace;
          }
        }

        const customPanel = !!(req.panelists && req.panelists.length > 0);
        const manualAgendas = !!(req.agendas && req.agendas.length > 0);
        const shouldPlan = req.planWithAi !== false && !manualAgendas;

        if (shouldPlan && !path.isAbsolute(workspace)) {
          throw Error(
            "NO_WORKSPACE: Choose a project workspace to convene a council.",
          );
        }

        const defaultProtocol = (
          ["council-standard", "adversarial-debate", "rapid-panel"].includes(
            String(settings.defaultProtocol),
          )
            ? settings.defaultProtocol
            : "council-standard"
        ) as CouncilProtocolId;

        let recommendation = null;
        if (!customPanel) {
          const { agents } = await bridge.listAgents(workspace || undefined);
          recommendation = recommendPanel({
            prompt: promptText || title,
            agents,
            workspace,
            workspaceLabel,
            protocol: req.protocol,
            defaultProtocol,
            expertCount: req.expertCount,
            locale,
          });
          if (!recommendation.readyCount) {
            throw Error(
              "NO_READY_AGENTS: No ready CodexHost agents are available.",
            );
          }
        }

        const protocol =
          req.protocol ?? recommendation?.protocol ?? defaultProtocol;
        const shouldAutoDispatch =
          shouldPlan &&
          (req.autoDispatch ?? settings.autoStartCouncil !== false);
        const shouldRefineRoles = shouldPlan && !customPanel;

        const hostMeta = {
          project_cwd: workspace,
          project_label: workspaceLabel,
          ...(customPanel ? (req.host ?? {}) : (recommendation?.host ?? {})),
          auto_dispatch: shouldAutoDispatch,
          auto_assign_roles: shouldRefineRoles,
        };

        const created = await store.transaction(null, (c) => {
          c.create("topic", {
            title,
            subtitle: req.subtitle ?? "",
            description,
            domain_tags: req.domain_tags ?? [],
            protocol_id: protocol,
            status: shouldPlan ? "in_progress" : "draft",
            panelists: customPanel
              ? req.panelists
              : (recommendation?.panelists ?? []),
            moderator: customPanel
              ? (req.moderator ?? {})
              : (recommendation?.moderator ?? {}),
            metadata: metadata({ codexhost: hostMeta }),
            agendas: manualAgendas ? req.agendas : [],
          });
          return hydrate(c.tree);
        });

        let planRun = null;
        if (shouldPlan) {
          planRun = await council.moderate("plan", created.id, {
            locale,
            ...(req.planningPrompt?.trim()
              ? { prompt: req.planningPrompt.trim() }
              : {}),
          });
        }
        const latest = await store.serial(async () =>
          hydrate(await store.load(created.id)),
        );
        return { topic: latest, planRun, recommendation };
      }
      case "council/set-auto-dispatch": {
        const enabled = z.boolean().parse(p.enabled);
        return store.transaction(tid(), (c) => {
          const existing = input(c.tree.metadata.codexhost ?? {});
          c.tree.metadata.codexhost = json.parse({
            ...existing,
            auto_dispatch: enabled,
          });
          c.emit("topic.updated", c.tree.id);
          return { auto_dispatch: enabled };
        });
      }
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
      c.reportLocale = locale;
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