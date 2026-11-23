import { useEffect, useState } from "react";
import { useL, useWorkspace } from "./context";
import { Modal } from "./ui";
import { protocols } from "../backend/domain/protocols";
import type { Topic } from "./types";

type Ref = { id: string; serviceTier?: string };
type Choice = {
  id: string;
  name: string;
  role: string;
  harnessId: string;
  model: Ref | null;
  thinking: string;
};
type Catalog = {
  models: {
    label?: string;
    ref: Ref;
    fastModel?: Ref;
    supportedThinkingOptionIds?: string[];
  }[];
  thinkingOptions?: { id: string; label?: string }[];
  defaultThinkingOptionId?: string;
};
const blank = (): Choice => ({
  id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join(""),
  name: "",
  role: "",
  harnessId: "",
  model: null,
  thinking: "",
});
const modelName = (m: Ref | null) =>
  m ? m.id + (m.serviceTier ? " · " + m.serviceTier : "") : "";
function Picker({
  value,
  set,
  ids,
  cwd,
  expert,
}: {
  value: Choice;
  set: (p: Choice) => void;
  ids: string[];
  cwd: string;
  expert: boolean;
}) {
  const l = useL(),
    { rpc } = useWorkspace();
  const [catalog, setCatalog] = useState<Catalog>(),
    [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setCatalog(undefined);
    setError("");
    if (value.harnessId)
      rpc
        .call<{ inspection: { catalog?: Catalog; error?: string } }>(
          "codexhost/harness-inspect",
          { harnessId: value.harnessId, ...(cwd ? { cwd } : {}) },
        )
        .then((r) => {
          if (current) {
            setCatalog(r.inspection.catalog);
            if (!r.inspection.catalog)
              setError(
                r.inspection.error ||
                  l("Catalog unavailable", "模型目录不可用"),
              );
          }
        })
        .catch((e) => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [rpc, value.harnessId, cwd]);
  const choices = (catalog?.models || []).flatMap((m) =>
    [m.ref, m.fastModel].flatMap((ref, i) =>
      ref
        ? [
            {
              ref,
              thinking: m.supportedThinkingOptionIds,
              label:
                (m.label || m.ref.id) +
                (/ultrafast/.test(modelName(ref))
                  ? " · Ultrafast"
                  : i || /priority|~fast/.test(modelName(ref))
                    ? " · Fast"
                    : "") +
                " (" +
                modelName(ref) +
                ")",
            },
          ]
        : [],
    ),
  );
  const selected = choices.find(
    (o) => modelName(o.ref) === modelName(value.model),
  );
  const thinking = (catalog?.thinkingOptions || []).filter(
    (o) => !selected?.thinking || selected.thinking.includes(o.id),
  );
  return (
    <div className="form-grid">
      {expert && (
        <>
          <label>
            {l("Display name", "显示名称")}
            <input
              required
              value={value.name}
              onChange={(e) => set({ ...value, name: e.target.value })}
            />
          </label>
          <label>
            {l("Research role", "研究角色")}
            <input
              value={value.role}
              onChange={(e) => set({ ...value, role: e.target.value })}
            />
          </label>
        </>
      )}
      <label>
        Harness
        <select
          aria-label="Harness"
          required
          value={value.harnessId}
          onChange={(e) =>
            set({
              ...value,
              harnessId: e.target.value,
              model: null,
              thinking: "",
            })
          }
        >
          <option value="">{l("Choose harness", "选择执行器")}</option>
          {ids.map((id) => (
            <option key={id}>{id}</option>
          ))}
        </select>
      </label>
      <label>
        {l("Model", "模型")}
        <select
          aria-label={l("Model", "模型")}
          value={modelName(value.model)}
          onChange={(e) =>
            set({
              ...value,
              model:
                choices.find((o) => modelName(o.ref) === e.target.value)?.ref ??
                null,
              thinking: "",
            })
          }
        >
          <option value="">{l("Harness default", "执行器默认")}</option>
          {choices.map((o) => (
            <option key={modelName(o.ref)} value={modelName(o.ref)}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        {l("Thinking level", "推理强度")}
        <select
          aria-label={l("Thinking level", "推理强度")}
          value={value.thinking}
          onChange={(e) => set({ ...value, thinking: e.target.value })}
        >
          <option value="">{l("Default", "默认")}</option>
          {thinking.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label || o.id}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
type DraftAgenda = {
  title: string;
  subs: { title: string; execution_mode: string }[];
};
export function Wizard({
  cwd: initial,
  close,
}: {
  cwd: string;
  close: () => void;
}) {
  const l = useL(),
    { rpc, settings, projects, perform, navigate, busy } = useWorkspace();
  const [step, go] = useState(0),
    [cwd, setCwd] = useState(initial),
    [title, setTitle] = useState(""),
    [subtitle, setSubtitle] = useState(""),
    [description, describe] = useState(""),
    [tags, setTags] = useState(""),
    [protocol, setProtocol] = useState(
      String(settings.defaultProtocol || "council-standard"),
    );
  const [people, roster] = useState<Choice[]>([]),
    [chair, setChair] = useState<Choice | null>(null),
    [agendas, plan] = useState<DraftAgenda[]>([]),
    [ids, setIds] = useState<string[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    rpc
      .call<{ harnesses: (string | { id: string })[] }>("codexhost/harnesses")
      .then((r) => {
        if (live)
          setIds(r.harnesses.map((h) => (typeof h === "string" ? h : h.id)));
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [rpc]);
  function change(i: number, a: DraftAgenda) {
    plan(agendas.map((v, j) => (j === i ? a : v)));
  }
  const config = (p: Choice) => ({
    harnessId: p.harnessId,
    model: p.model,
    thinking: p.thinking,
  });
  async function submit() {
    if (step < 2) {
      go(step + 1);
      return;
    }
    await perform(async () => {
      const topic = await rpc.call<Topic>("topics/create", {
        data: {
          title: title.trim(),
          subtitle,
          description,
          domain_tags: tags
            .split(/[,，]/)
            .map((x) => x.trim())
            .filter(Boolean),
          protocol_id: protocol,
          panelists: people.map((p) => ({
            id: p.id,
            name: p.name.trim(),
            role: p.role,
            model: modelName(p.model),
            provider: p.harnessId,
            reasoning_effort: p.thinking,
          })),
          moderator: chair
            ? {
                name: l("Moderator", "主持人"),
                model: modelName(chair.model),
                provider: chair.harnessId,
              }
            : {},
          metadata: {
            codexhost: {
              project_cwd: cwd.trim(),
              project_label:
                projects.find((p) => p.cwd === cwd)?.name ||
                cwd.split(/[\\/]/).filter(Boolean).pop() ||
                "",
              panelist_threads: Object.fromEntries(
                people.map((p) => [p.id, config(p)]),
              ),
              moderator_config: chair ? config(chair) : null,
            },
          },
          agendas: agendas.map((a) => ({
            title: a.title,
            sub_agendas: a.subs,
          })),
        },
      });
      close();
      navigate({ topicId: topic.id });
    });
  }
  const steps = [
    l("Council details", "议题信息"),
    l("Expert panel", "专家组"),
    l("Agendas", "议程"),
  ];
  return (
    <Modal title={l("New Council", "新建议题")} close={close} wide>
      <form
        className="council-wizard"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <ol className="stepper">
          {steps.map((s, i) => (
            <li aria-current={step === i ? "step" : undefined} key={i}>
              {s}
            </li>
          ))}
        </ol>
        {step === 0 && (
          <div className="form-grid council-details">
            <label>
              {l("Project workspace", "项目工作区")}
              <input
                aria-label={l("Project workspace", "项目工作区")}
                list="althing-project-choices"
                value={cwd}
                onChange={(e) => {
                  setCwd(e.target.value);
                  roster(
                    people.map((p) => ({ ...p, model: null, thinking: "" })),
                  );
                  if (chair) setChair({ ...chair, model: null, thinking: "" });
                }}
                placeholder={l(
                  "Choose or enter a workspace path",
                  "选择或输入工作区路径",
                )}
              />
              <datalist id="althing-project-choices">
                {projects.map((p) => (
                  <option key={p.cwd} value={p.cwd}>
                    {p.name}
                  </option>
                ))}
              </datalist>
            </label>
            <label>
              {l("Title", "标题")}
              <input
                ref={(input) => {
                  // showModal uses the native autofocus attribute when it opens.
                  if (input) input.autofocus = true;
                }}
                required
                maxLength={500}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              {l("Subtitle", "副标题")}
              <input
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
              />
            </label>
            <label>
              {l("Tags", "标签")}
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder={l("Separate with commas", "用逗号分隔")}
              />
            </label>
            <label className="full">
              {l("Description", "说明")}
              <textarea
                value={description}
                onChange={(e) => describe(e.target.value)}
              />
            </label>
            <label>
              {l("Discussion protocol", "讨论协议")}
              <select
                aria-label={l("Discussion protocol", "讨论协议")}
                value={protocol}
                onChange={(e) => setProtocol(e.target.value)}
              >
                {protocols.map((p, i) => (
                  <option key={p.id} value={p.id}>
                    {l(p.name, ["标准议事", "对抗辩论", "快速专家组"][i])}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {step === 1 && (
          <>
            {error && <p role="alert">{error}</p>}
            {people.map((p, i) => (
              <fieldset key={p.id}>
                <legend>
                  {l("Expert", "专家")} {i + 1}
                </legend>
                <Picker
                  expert
                  value={p}
                  ids={ids}
                  cwd={cwd}
                  set={(v) =>
                    roster(people.map((q) => (q.id === p.id ? v : q)))
                  }
                />
                <button
                  type="button"
                  onClick={() => roster(people.filter((q) => q.id !== p.id))}
                >
                  {l("Remove expert", "移除专家")}
                </button>
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
              <Picker
                expert={false}
                value={chair}
                set={setChair}
                ids={ids}
                cwd={cwd}
              />
            )}
          </>
        )}
        {step === 2 && (
          <>
            {agendas.length === 0 && (
              <p className="small">
                {l(
                  "Add an agenda here, or use AI planning after creation.",
                  "可在此添加议程，或创建后使用 AI 规划议程。",
                )}
              </p>
            )}
            {agendas.map((a, i) => (
              <fieldset key={i}>
                <label>
                  {l("Agenda title", "议程标题")}
                  <input
                    required
                    value={a.title}
                    onChange={(e) => change(i, { ...a, title: e.target.value })}
                  />
                </label>
                {a.subs.map((s, j) => (
                  <div className="form-grid" key={j}>
                    <label>
                      {l("Sub-agenda title", "子议题标题")}
                      <input
                        required
                        value={s.title}
                        onChange={(e) =>
                          change(i, {
                            ...a,
                            subs: a.subs.map((v, n) =>
                              n === j ? { ...v, title: e.target.value } : v,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      {l("Execution", "执行方式")}
                      <select
                        aria-label={l("Execution", "执行方式")}
                        value={s.execution_mode}
                        onChange={(e) =>
                          change(i, {
                            ...a,
                            subs: a.subs.map((v, n) =>
                              n === j
                                ? { ...v, execution_mode: e.target.value }
                                : v,
                            ),
                          })
                        }
                      >
                        <option value="parallel">
                          {l("Parallel", "并行")}
                        </option>
                        <option value="sequential">
                          {l("Sequential", "顺序")}
                        </option>
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        change(i, {
                          ...a,
                          subs: a.subs.filter((_, n) => n !== j),
                        })
                      }
                    >
                      {l("Remove sub-agenda", "移除子议题")}
                    </button>
                  </div>
                ))}
                <div className="tools">
                  <button
                    type="button"
                    onClick={() =>
                      change(i, {
                        ...a,
                        subs: [
                          ...a.subs,
                          {
                            title: "",
                            execution_mode:
                              protocol === "adversarial-debate"
                                ? "sequential"
                                : "parallel",
                          },
                        ],
                      })
                    }
                  >
                    + {l("Add sub-agenda", "添加子议题")}
                  </button>
                  <button
                    type="button"
                    onClick={() => plan(agendas.filter((_, j) => j !== i))}
                  >
                    {l("Remove agenda", "移除议程")}
                  </button>
                </div>
              </fieldset>
            ))}
            <button
              type="button"
              onClick={() => plan([...agendas, { title: "", subs: [] }])}
            >
              + {l("Add agenda", "添加议程")}
            </button>
          </>
        )}
        <footer className="form-footer">
          {step > 0 && (
            <button type="button" onClick={() => go(step - 1)}>
              {l("Back", "上一步")}
            </button>
          )}
          <button className="primary" disabled={busy}>
            {step < 2
              ? l("Continue", "下一步")
              : l("Create council", "创建议题")}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
