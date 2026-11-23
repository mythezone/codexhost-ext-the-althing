export type AgentModel = { id: string; serviceTier?: "priority" | "ultrafast" };
export type CatalogModel = {
  ref: AgentModel;
  fastModel: AgentModel | null;
  label: string;
  resolvedModelLabel: string;
  supportedThinkingOptionIds: string[] | null;
};
export type Agent = {
  id: string;
  label: string;
  section: "main" | "delegation" | "more" | "auto";
  configuredForDelegation: boolean;
  status: "ready" | "unavailable" | "error" | "notInstalled";
  statusMessage: string;
  defaultModel: AgentModel | null;
  defaultThinking: string;
  defaultThinkingLabel: string;
  models: CatalogModel[];
  thinkingOptions: { id: string; label: string }[];
};
export function modelKey(ref?: AgentModel | string | null) {
  return typeof ref === "string"
    ? ref
    : ref
      ? ref.id + (ref.serviceTier ? " · " + ref.serviceTier : "")
      : "";
}
export function modelEntry(models: CatalogModel[], ref?: AgentModel | null) {
  return (
    ref &&
    models.find(
      (m) =>
        modelKey(m.ref) === modelKey(ref) ||
        modelKey(m.fastModel) === modelKey(ref),
    )
  );
}
export function modelLabel(
  agent: Pick<Agent, "models">,
  ref: AgentModel | null,
) {
  if (!ref) return "Default";
  const entry = modelEntry(agent.models, ref);
  const base =
    entry?.resolvedModelLabel && entry.label === "Default (recommended)"
      ? "Default"
      : entry?.label || ref.id;
  const resolved = entry?.resolvedModelLabel;
  const speed =
    ref.serviceTier === "ultrafast" || ref.id.endsWith("~ultrafast")
      ? " · Ultrafast"
      : ref.serviceTier === "priority" ||
          ref.id.endsWith("~fast") ||
          (entry?.fastModel && modelKey(entry.fastModel) === modelKey(ref))
        ? " · Fast"
        : "";
  return (
    base + (resolved && resolved !== base ? " (" + resolved + ")" : "") + speed
  );
}
export function thinkingLabel(
  id: string,
  options: Agent["thinkingOptions"] = [],
) {
  const label = options.find((o) => o.id === id)?.label;
  if (label && label !== id) return label;
  if (!id) return "Auto";
  // Cursor embeds a list of setting/value pairs in IDs. Older catalogs may omit labels.
  if (id.startsWith("cursor.")) {
    try {
      const rows: unknown = JSON.parse(
        atob(id.slice(7).replace(/-/g, "+").replace(/_/g, "/")),
      );
      if (Array.isArray(rows)) {
        const level = rows.find(
          (pair) => Array.isArray(pair) && ["reasoning_effort","effort"].includes(pair[0]),
        )?.[1];
        if (typeof level === "string" && /^[a-z_ -]{1,30}$/i.test(level))
          return level === "xhigh"
            ? "Extra High"
            : level[0].toUpperCase() + level.slice(1);
      }
    } catch {}
    return "Custom";
  }
  return label || id;
}
export function thinkingFor(agent: Agent, ref: AgentModel | null) {
  const ids = modelEntry(
    agent.models,
    ref ?? agent.defaultModel,
  )?.supportedThinkingOptionIds;
  const options = ids
    ? [...new Set(ids)].map((id) => ({
        id,
        label: thinkingLabel(id, agent.thinkingOptions),
      }))
    : agent.thinkingOptions;
  const labels = new Set<string>();
  if (ids) return options;
  return options.filter((o) => {
    if (labels.has(o.label)) return false;
    labels.add(o.label);
    return true;
  });
}
export function sameAssignment(
  a: {
    harnessId: string;
    model?: AgentModel | string | null;
    thinking?: string;
  },
  b: typeof a,
) {
  return (
    a.harnessId === b.harnessId &&
    modelKey(a.model) === modelKey(b.model) &&
    (a.thinking || "") === (b.thinking || "")
  );
}
