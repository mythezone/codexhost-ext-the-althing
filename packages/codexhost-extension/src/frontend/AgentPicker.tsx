import { useEffect, useState } from "react";
import { useL, useWorkspace } from "./context";
import {
  modelKey,
  modelLabel,
  thinkingFor,
  thinkingLabel,
  type Agent,
  type AgentModel,
} from "../shared/agents";
import type { Topic } from "./types";

export type Seat = {
  id: string;
  name: string;
  role: string;
  harnessId: string;
  model: AgentModel | null;
  thinking: string;
  modelLabel: string;
  thinkingLabel: string;
};
export const blank = (): Seat => ({
  id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join(""),
  name: "",
  role: "",
  harnessId: "",
  model: null,
  thinking: "",
  modelLabel: "",
  thinkingLabel: "",
});
type WireConfig = {
  harnessId: string;
  model?: AgentModel | string | null;
  thinking?: string;
};
type HostRoster = {
  project_cwd?: string;
  panelist_threads?: Record<string, WireConfig>;
  moderator_config?: WireConfig | null;
  moderator_display?: { role: string; reasoning_effort: string } | null;
};
export function hostRoster(topic: Topic) {
  return (topic.metadata.codexhost || {}) as HostRoster;
}
export function assignments(
  people: Seat[],
  chair: Seat | null,
  moderatorName: string,
  topic?: Topic,
) {
  const config = (s: Seat) => ({
    harnessId: s.harnessId,
    model: s.model,
    thinking: s.thinking,
  });
  return {
    panelists: people.map((p) => ({
      ...topic?.panelists.find((old) => old.id === p.id),
      id: p.id,
      name: p.name.trim(),
      role: p.role,
      model: p.modelLabel,
      provider: p.harnessId,
      reasoning_effort: p.thinkingLabel,
    })),
    moderator: chair
      ? {
          name: moderatorName,
          model: chair.modelLabel,
          provider: chair.harnessId,
        }
      : {},
    host: {
      panelist_threads: Object.fromEntries(
        people.filter((p) => p.harnessId).map((p) => [p.id, config(p)]),
      ),
      moderator_config: chair?.harnessId ? config(chair) : null,
      moderator_display: chair
        ? { role: chair.role, reasoning_effort: chair.thinkingLabel }
        : null,
    },
  };
}
export function initialSeat(
  person: {
    id?: string;
    name: string;
    role?: string;
    model: string;
    provider: string;
    reasoning_effort?: string;
  },
  cfg?: WireConfig | null,
): Seat {
  const raw = cfg ? (cfg.model ?? null) : person.model;
  const thinking = cfg?.thinking ?? person.reasoning_effort ?? "";
  return {
    ...blank(),
    ...(person.id ? { id: person.id } : {}),
    name: person.name,
    role: person.role || "",
    harnessId: cfg?.harnessId ?? person.provider,
    model: typeof raw === "string" ? (raw ? { id: raw } : null) : raw,
    modelLabel: person.model,
    thinking,
    thinkingLabel: thinkingLabel(person.reasoning_effort || thinking),
  };
}
function assign(seat: Seat, agent: Agent, previousName?: string): Seat {
  const model = agent.defaultModel;
  return {
    ...seat,
    name:
      !seat.name ||
      /^(?:expert|专家)\s*\d+$/i.test(seat.name) ||
      seat.name === previousName
        ? agent.label
        : seat.name,
    harnessId: agent.id,
    model,
    modelLabel: modelLabel(agent, model),
    thinking: agent.defaultThinking,
    thinkingLabel: agent.defaultThinkingLabel,
  };
}
const roles = [
  ["Architecture & technical design", "架构与技术方案"],
  ["Red team & critique", "反向质询 / 红队"],
  ["Engineering & performance", "工程落地与性能"],
  ["Product & user experience", "产品与用户体验"],
  ["Safety & risk assessment", "安全与风险评估"],
  ["General review", "综合评审"],
];
function Picker({
  value,
  set,
  agents,
  expert,
}: {
  value: Seat;
  set: (s: Seat) => void;
  agents: Agent[];
  expert: boolean;
}) {
  const l = useL();
  const agent = agents.find((a) => a.id === value.harnessId);
  const choices = agent
    ? [
        ...new Map(
          agent.models.flatMap((m) =>
            [m.ref, m.fastModel]
              .filter((r): r is AgentModel => !!r)
              .map((r) => [modelKey(r), r] as const),
          ),
        ).values(),
      ]
    : [];
  const options = agent ? thinkingFor(agent, value.model) : [];
  const presets = roles.map(([en, zh]) => l(en, zh));
  return (
    <div className="form-grid agent-fields">
      <label>
        {l("Agent (harness)", "Agent（执行器）")}
        <select
          aria-label={l("Harness", "执行器")}
          required={!value.harnessId && !value.modelLabel}
          value={value.harnessId}
          onChange={(e) => {
            const next = agents.find((a) => a.id === e.target.value);
            if (next?.status === "ready")
              set(assign(value, next, agent?.label));
          }}
        >
          <option value="" disabled>
            {l("Choose agent", "选择 Agent")}
          </option>
          {value.harnessId && !agent && (
            <option value={value.harnessId}>{value.harnessId}</option>
          )}
          {[
            l("Ready collaboration agents", "多 Agent 协作已就绪"),
            l("Other available agents", "其他可用 Agent"),
            l("Unavailable / not installed", "未就绪 / 未安装"),
          ].map((group, i) => (
            <optgroup label={group} key={group}>
              {agents
                .filter(
                  (a) =>
                    (a.status !== "ready"
                      ? 2
                      : a.configuredForDelegation
                        ? 0
                        : 1) === i,
                )
                .map((a) => (
                  <option
                    key={a.id}
                    value={a.id}
                    disabled={a.status !== "ready"}
                  >
                    {a.label} ·{" "}
                    {a.status === "ready"
                      ? a.defaultThinkingLabel
                      : a.statusMessage || a.status}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label>
        {l("Model", "模型")}
        <select
          aria-label={l("Model", "模型")}
          value={modelKey(value.model)}
          onChange={(e) => {
            if (!agent) return;
            const model =
              choices.find((m) => modelKey(m) === e.target.value) ??
              agent.defaultModel;
            const valid = thinkingFor(agent, model);
            const thinking = valid.some((o) => o.id === value.thinking)
              ? value.thinking
              : valid.some((o) => o.id === agent.defaultThinking)
                ? agent.defaultThinking
                : (agent.defaultThinking && valid[0]?.id) || "";
            set({
              ...value,
              model,
              modelLabel: modelLabel(agent, model),
              thinking,
              thinkingLabel: thinkingLabel(thinking, agent.thinkingOptions),
            });
          }}
        >
          <option value="">{l("Harness default", "执行器默认")}</option>
          {value.model &&
            !choices.some((r) => modelKey(r) === modelKey(value.model)) && (
              <option value={modelKey(value.model)}>
                {value.modelLabel || value.model.id}
              </option>
            )}
          {choices.map((ref) => (
            <option key={modelKey(ref)} value={modelKey(ref)}>
              {modelLabel(agent!, ref)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {l("Thinking level", "推理强度")}
        <select
          aria-label={l("Thinking level", "推理强度")}
          value={value.thinking}
          onChange={(e) =>
            set({
              ...value,
              thinking: e.target.value,
              thinkingLabel: thinkingLabel(
                e.target.value,
                agent?.thinkingOptions,
              ),
            })
          }
        >
          <option value="">
            {l("Auto (host default)", "自动（宿主默认）")}
          </option>
          {value.thinking &&
            (!agent || agent.status !== "ready") &&
            !options.some((o) => o.id === value.thinking) && (
              <option value={value.thinking}>{value.thinkingLabel}</option>
            )}
          {options.map((o) => (
            <option value={o.id} key={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {expert && (
        <label>
          {l("Display name", "显示名称")}
          <input
            required
            value={value.name}
            onChange={(e) => set({ ...value, name: e.target.value })}
          />
        </label>
      )}
      <label>
        {l("Role preset", "会议角色预设")}
        <select
          value={presets.includes(value.role) ? value.role : ""}
          onChange={(e) => set({ ...value, role: e.target.value })}
        >
          <option value="">{l("Custom…", "自定义…")}</option>
          {presets.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <label>
        {l("Research role", "研究角色")}
        <input
          value={value.role}
          onChange={(e) => set({ ...value, role: e.target.value })}
        />
      </label>
      {agent && agent.status !== "ready" && (
        <p role="alert">{agent.statusMessage || agent.status}</p>
      )}
    </div>
  );
}
export function RosterFields({
  cwd,
  people,
  roster,
  chair,
  setChair,
  locked,
}: {
  cwd: string;
  people: Seat[];
  roster: (p: Seat[]) => void;
  chair: Seat | null;
  setChair: (c: Seat | null) => void;
  locked?: Set<string>;
}) {
  const l = useL(),
    { rpc } = useWorkspace();
  const [agents, setAgents] = useState<Agent[]>([]),
    [revision, refresh] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    rpc
      .call<{ agents: Agent[] }>(
        "codexhost/agents",
        { ...(cwd ? { cwd } : {}), refresh: revision > 0 },
        abort.signal,
      )
      .then((result) => {
        if (!abort.signal.aborted) setAgents(result.agents);
      })
      .catch((e) => {
        if (!abort.signal.aborted)
          setError(
            typeof e?.message === "string"
              ? e.message
              : "Agent directory unavailable",
          );
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [rpc, cwd, revision]);
  const ready = agents.filter((a) => a.status === "ready"),
    collaborative = ready.filter((a) => a.configuredForDelegation);
  function add(all: Agent[]) {
    const next = [...people];
    for (const agent of all) {
      const index = next.findIndex((s) => !s.harnessId);
      if (index === -1) next.push(assign(blank(), agent));
      else next[index] = assign(next[index], agent);
    }
    roster(next);
  }
  return (
    <>
      <section className="agent-directory" aria-busy={loading}>
        <h3>{l("Available collaboration agents", "多 Agent 协作可用席位")}</h3>
        <div className="tools">
          {ready.map((a) => (
            <button type="button" key={a.id} onClick={() => add([a])}>
              {a.label} · {modelLabel(a, a.defaultModel)} ·{" "}
              {a.defaultThinkingLabel}
            </button>
          ))}
        </div>
        {loading && (
          <p role="status">
            {l("Reading host agents…", "正在读取宿主 Agent…")}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="tools">
          <button
            type="button"
            disabled={
              !collaborative.some(
                (a) => !people.some((p) => p.harnessId === a.id),
              )
            }
            onClick={() =>
              add(
                collaborative.filter(
                  (a) => !people.some((p) => p.harnessId === a.id),
                ),
              )
            }
          >
            {l("Add collaboration experts", "一键加入协作专家")}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => refresh((n) => n + 1)}
          >
            {l("Refresh list", "刷新列表")}
          </button>
        </div>
      </section>
      {people.map((p, i) => (
        <fieldset key={p.id}>
          <legend>
            {l("Expert", "专家")} {i + 1}
          </legend>
          <Picker
            expert
            value={p}
            agents={agents}
            set={(v) => roster(people.map((q) => (q.id === p.id ? v : q)))}
          />
          <button
            type="button"
            disabled={locked?.has(p.id)}
            onClick={() => roster(people.filter((q) => q.id !== p.id))}
          >
            {l("Remove expert", "移除专家")}
          </button>
          {locked?.has(p.id) && (
            <small>
              {" "}
              {l(
                "Referenced by a dispatch or contribution",
                "已有派发或发言记录",
              )}
            </small>
          )}
        </fieldset>
      ))}
      <button type="button" onClick={() => roster([...people, blank()])}>
        + {l("Add expert", "添加专家")}
      </button>
      <label className="check">
        <input
          type="checkbox"
          checked={!!chair}
          onChange={(e) => setChair(e.target.checked ? blank() : null)}
        />
        {l("Configure moderator", "配置主持人")}
      </label>
      {chair && (
        <fieldset>
          <legend>{l("Moderator", "主持人")}</legend>
          <Picker expert={false} value={chair} set={setChair} agents={agents} />
        </fieldset>
      )}
    </>
  );
}
