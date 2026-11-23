import { useState } from "react";
import { useL, useWorkspace } from "./context";
import { Modal } from "./ui";
import { protocols } from "../backend/domain/protocols";
import type { Topic } from "./types";

import {
  assignments,
  blank,
  RosterFields,
  type Seat as Choice,
} from "./AgentPicker";
type DraftAgenda = {
  title: string;
  subs: { title: string; execution_mode: string }[];
};
export function Wizard({
  cwd: initial,
  commandTopic,
  close,
}: {
  cwd: string;
  commandTopic?: string;
  close: () => void;
}) {
  const l = useL(),
    { rpc, settings, projects, perform, navigate, refresh, busy } =
      useWorkspace();
  const guided = commandTopic !== undefined;
  const expert = (i: number) => ({
    ...blank(),
    name: l("Expert ", "专家 ") + (i + 1),
  });
  const [step, go] = useState(0),
    [cwd, setCwd] = useState(initial),
    [title, setTitle] = useState(commandTopic ?? ""),
    [subtitle, setSubtitle] = useState(""),
    [description, describe] = useState(""),
    [tags, setTags] = useState(""),
    [protocol, setProtocol] = useState(
      String(settings.defaultProtocol || "council-standard"),
    );
  const [people, roster] = useState<Choice[]>(() =>
      guided ? [expert(0), expert(1)] : [],
    ),
    [askModerator, setAskModerator] = useState(guided),
    [questions, setQuestions] = useState(""),
    [chair, setChair] = useState<Choice | null>(null),
    [agendas, plan] = useState<DraftAgenda[]>([]),
    [error, setError] = useState("");
  function change(i: number, a: DraftAgenda) {
    plan(agendas.map((v, j) => (j === i ? a : v)));
  }
  async function submit() {
    if (step < 2) {
      if (
        guided &&
        step === 0 &&
        !/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(cwd.trim())
      ) {
        setError(
          l("Choose an absolute workspace path.", "请选择项目或填写绝对路径。"),
        );
        return;
      }
      if (guided && step === 1 && !people.length) return;
      setError("");
      go(step + 1);
      return;
    }
    const moderator = chair || (guided ? people[0] : undefined);
    const selected = assignments(
      people,
      moderator ?? null,
      l("Moderator", "主持人"),
    );
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
          panelists: selected.panelists,
          moderator: selected.moderator,
          metadata: {
            codexhost: {
              project_cwd: cwd.trim(),
              project_label:
                projects.find((p) => p.cwd === cwd)?.name ||
                cwd.split(/[\\/]/).filter(Boolean).pop() ||
                "",
              ...selected.host,
            },
          },
          agendas: askModerator
            ? []
            : agendas.map((a) => ({
                title: a.title,
                sub_agendas: a.subs,
              })),
        },
      });
      close();
      navigate({ topicId: topic.id });
      if (askModerator) {
        try {
          await rpc.call("council/plan-topic", {
            topicId: topic.id,
            ...(questions.trim() && { prompt: questions.trim() }),
          });
        } catch (e) {
          refresh();
          throw Error(
            l(
              "Council saved. Retry AI planning in Council actions.",
              "议题已保存，可在「议题操作」中重试 AI 规划。",
            ) +
              " " +
              (e as Error).message,
          );
        }
      }
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
                required={guided}
                list="althing-project-choices"
                value={cwd}
                onChange={(e) => {
                  setCwd(e.target.value);
                  roster(
                    people.map((p) => ({
                      ...p,
                      harnessId: "",
                      model: null,
                      thinking: "",
                      modelLabel: "",
                      thinkingLabel: "",
                    })),
                  );
                  if (chair)
                    setChair({
                      ...chair,
                      harnessId: "",
                      model: null,
                      thinking: "",
                      modelLabel: "",
                      thinkingLabel: "",
                    });
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
            {guided && (
              <label>
                {l("How many experts should participate?", "邀请几位专家？")}
                <select
                  value={people.length}
                  onChange={(e) => {
                    const count = Number(e.target.value);
                    roster(
                      Array.from(
                        { length: count },
                        (_, i) => people[i] ?? expert(i),
                      ),
                    );
                  }}
                >
                  {Array.from(new Set([1, 2, 3, 4, 5, 6, people.length]))
                    .sort((a, b) => a - b)
                    .map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                </select>
              </label>
            )}
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
            {guided && (
              <p>
                {l(
                  "Which models should discuss this topic? The first expert also chairs the council unless you select a separate moderator.",
                  "邀请哪些模型讨论？默认由第一位专家兼任主持人，也可以单独选择主持模型。",
                )}
              </p>
            )}
            <RosterFields {...{ cwd, people, roster, chair, setChair }} />
          </>
        )}
        {step === 2 && guided && (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={askModerator}
                onChange={(e) => setAskModerator(e.target.checked)}
              />
              {l(
                "Ask the moderator to propose agendas and sub-agendas",
                "由主持模型建议议程与子议题",
              )}
            </label>
            {askModerator && (
              <label>
                {l(
                  "Which questions should the moderator consider?",
                  "希望主持人优先讨论哪些问题？",
                )}
                <textarea
                  rows={4}
                  value={questions}
                  onChange={(e) => setQuestions(e.target.value)}
                />
                <small>
                  {l(
                    "Review the proposed agenda before dispatching experts.",
                    "可先审阅生成的议程，再派发专家讨论。",
                  )}
                </small>
              </label>
            )}
          </>
        )}
        {step === 2 && !askModerator && (
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
        {error && <p role="alert">{error}</p>}
        <footer className="form-footer">
          {step > 0 && (
            <button type="button" onClick={() => go(step - 1)}>
              {l("Back", "上一步")}
            </button>
          )}
          <button
            className="primary"
            disabled={busy || (guided && step === 1 && people.length === 0)}
          >
            {step < 2
              ? l("Continue", "下一步")
              : askModerator
                ? l("Create and plan agenda", "创建并规划议程")
                : l("Create council", "创建议题")}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
