import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import type { CodexHostBridge } from "./codexhost-bridge.ts";
import {
  modelEntry,
  thinkingLabel,
  type Agent,
  type AgentModel,
  type CatalogModel,
} from "../shared/agents.ts";

const obj = (x: unknown): Record<string, unknown> =>
  x && typeof x === "object" && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : {};
const str = (x: unknown) => (typeof x === "string" ? x : "");
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
function ref(x: unknown): AgentModel | null {
  const id = str(x) || str(obj(x).id),
    tier = obj(x).serviceTier;
  return id
    ? {
        id,
        ...(tier === "priority" || tier === "ultrafast"
          ? { serviceTier: tier }
          : {}),
      }
    : null;
}
async function preference(dir: string, name: string): Promise<unknown> {
  try {
    const file = await open(
      path.join(dir, name),
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    try {
      const info = await file.stat();
      if (
        !info.isFile() ||
        info.size > 512 * 1024 ||
        (process.getuid && info.uid !== process.getuid())
      )
        return null;
      const bytes = Buffer.alloc(info.size + 1);
      const { bytesRead } = await file.read(bytes);
      return bytesRead === info.size
        ? JSON.parse(bytes.toString("utf8", 0, bytesRead))
        : null;
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}
const names: Record<string, string> = {
  codex: "Codex",
  antigravity: "Antigravity",
  "claude-code": "Claude Code",
  grok: "Grok",
  codebuddy: "CodeBuddy",
  "cursor-cli": "Cursor CLI",
  copilot: "Copilot",
  opencode: "OpenCode",
  "kimi-code": "Kimi Code",
};
export async function agentDirectory(
  bridge: CodexHostBridge,
  dir: string,
  cwd?: string,
  refresh = false,
) {
  const [{ harnesses }, pref, display] = await Promise.all([
    bridge.listHarnesses(),
    preference(dir, "harness-preferences-v1.json"),
    preference(dir, "harness-display-settings-v1.json"),
  ]);
  const external = obj(obj(obj(pref).scopes).external);
  const delegation = obj(obj(external.delegation).byHarness),
    newThread = obj(obj(external.newThread).byHarness);
  const order = list(display).map(obj);
  const agents: Agent[] = [];
  const queue = harnesses.values();
  async function inspect() {
    for (const h of queue) {
      const id = str(h) || str(obj(h).id);
      if (!id) continue;
      let inspection;
      try {
        inspection = obj(
          (await bridge.inspectHarness(id, cwd, refresh)).inspection,
        );
      } catch (e) {
        inspection = {
          status: "error",
          error: {
            message: e instanceof Error ? e.message : "Inspection failed",
          },
        };
      }
      const catalog = obj(inspection.catalog);
      const models = list(catalog.models).flatMap((row) => {
        const m = obj(row),
          base = ref(m.ref);
        if (!base) return [];
        return [
          {
            ref: base,
            fastModel: ref(m.fastModel),
            label: str(m.label) || base.id,
            resolvedModelLabel: str(m.resolvedModelLabel),
            supportedThinkingOptionIds: Array.isArray(
              m.supportedThinkingOptionIds,
            )
              ? m.supportedThinkingOptionIds.filter(
                  (v): v is string => typeof v === "string",
                )
              : null,
          },
        ];
      }) satisfies CatalogModel[];
      const thinkingOptions = list(catalog.thinkingOptions).flatMap((row) => {
        const o = obj(row),
          key = str(o.id);
        return key
          ? [{ id: key, label: str(o.label) || thinkingLabel(key) }]
          : [];
      });
      const d = obj(delegation[id]),
        n = obj(newThread[id]);
      function advertised(value: unknown) {
        const saved = ref(value);
        if (!saved || modelEntry(models, saved)) return saved;
        // Older Cursor preferences omit the explicit [fast=false] suffix of the base model.
        if (id === "cursor-cli" && saved.id.startsWith("cursor.")) {
          const base = Buffer.from(saved.id.slice(7), "base64url").toString(
            "utf8",
          );
          const current =
            "cursor." +
            Buffer.from(base + "[fast=false]").toString("base64url");
          return models.find((m) => m.ref.id === current)?.ref ?? null;
        }
        return null;
      }
      const defaultModel =
        [d.model, n.model, catalog.defaultModel, models[0]?.ref]
          .map(advertised)
          .find(Boolean) ?? null;
      const supported = modelEntry(
        models,
        defaultModel,
      )?.supportedThinkingOptionIds;
      let defaultThinking = "";
      for (const value of [
        d.thinkingOptionId,
        n.thinkingOptionId,
        catalog.defaultThinkingOptionId,
      ]) {
        if (value === null) break;
        if (
          typeof value === "string" &&
          (supported
            ? supported.includes(value)
            : !thinkingOptions.length ||
              thinkingOptions.some((o) => o.id === value))
        ) {
          defaultThinking = value;
          break;
        }
      }
      const section = order.find((row) => row.agent === id)?.section;
      const error = obj(inspection.error);
      const status = inspection.status;
      agents.push({
        id,
        label:
          str(obj(h).label) ||
          names[id] ||
          id.replace(
            /(^|-)([a-z])/g,
            (_, s, c) => (s ? " " : "") + c.toUpperCase(),
          ),
        configuredForDelegation: Object.hasOwn(delegation, id),
        section:
          section === "main" || section === "delegation" || section === "more"
            ? section
            : "auto",
        status:
          status === "ready" || status === "notInstalled"
            ? status
            : error.code === "authenticationRequired" ||
                status === "unavailable"
              ? "unavailable"
              : "error",
        statusMessage: (
          str(error.message) ||
          str(error.code) ||
          str(inspection.error)
        ).slice(0, 400),
        defaultModel,
        defaultThinking,
        defaultThinkingLabel: thinkingLabel(defaultThinking, thinkingOptions),
        models,
        thinkingOptions,
      });
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(4, harnesses.length) }, inspect),
  );
  const rank = (a: Agent) =>
    a.status !== "ready" ? 2 : a.configuredForDelegation ? 0 : 1;
  const index = (id: string) => {
    const i = order.findIndex((row) => row.agent === id);
    return i < 0 ? Infinity : i;
  };
  agents.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Number(b.section === "main") - Number(a.section === "main") ||
      index(a.id) - index(b.id) ||
      a.label.localeCompare(b.label),
  );
  return { agents };
}
