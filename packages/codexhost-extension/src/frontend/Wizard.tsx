import { useEffect, useState } from "react";
import { useL, useWorkspace } from "./context";
import { Modal } from "./ui";
import { protocols } from "../backend/domain/protocols";
import type { Topic } from "./types";
import type { CouncilProtocolId } from "../shared/command";
import type { PanelRecommendation } from "../backend/smart-panel";
import {
  assignments,
  initialSeat,
  RosterFields,
  type Seat as Choice,
} from "./AgentPicker";

type DraftAgenda = {
  title: string;
  subs: { title: string; execution_mode: string }[];
};

function seatsFromRecommendation(rec: PanelRecommendation): Choice[] {
  return rec.panelists.map((p) =>
    initialSeat(p, rec.host.panelist_threads[p.id]),
  );
}

export function Wizard({
  cwd: initial,
  commandTopic,
  initialProtocol,
  initialExpertCount,
  initialCustom = false,
  close,
}: {
  cwd: string;
  commandTopic?: string;
  initialProtocol?: CouncilProtocolId;
  initialExpertCount?: number;
  initialCustom?: boolean;
  close: () => void;
}) {
  const l = useL(),
    { rpc, settings, projects, perform, navigate, busy } = useWorkspace();
  const [cwd, setCwd] = useState(initial),
    [title, setTitle] = useState(commandTopic ?? ""),
    [subtitle, setSubtitle] = useState(""),
    [description, describe] = useState(""),
    [tags, setTags] = useState(""),
    [protocol, setProtocol] = useState<string>(
      initialProtocol || String(settings.defaultProtocol || "council-standard"),
    );
  const [customize, setCustomize] = useState(initialCustom),
    [touchedRoster, setTouchedRoster] = useState(false),
    [touchedProtocol, setTouchedProtocol] = useState(Boolean(initialProtocol)),
    [people, setPeople] = useState<Choice[]>([]),
    [chair, setChair] = useState<Choice | null>(null),
    [askModerator, setAskModerator] = useState(true),
    [autoDispatch, setAutoDispatch] = useState(
      settings.autoStartCouncil !== false,
    ),
    [questions, setQuestions] = useState(""),
    [agendas, plan] = useState<DraftAgenda[]>([]),
    [recommendation, setRecommendation] = useState<PanelRecommendation | null>(
      null,
    ),
    [recommending, setRecommending] = useState(true),
    [error, setError] = useState("");

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setRecommending(true);
      rpc
        .call<PanelRecommendation>(
          "council/recommend-panel",
          {
            ...(title.trim() ? { prompt: title.trim() } : {}),
            ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
            ...(touchedProtocol
              ? { protocol: protocol as CouncilProtocolId }
              : {}),
            ...(initialExpertCount ? { expertCount: initialExpertCount } : {}),
          },
          ctrl.signal,
        )
        .then((rec) => {
          if (ctrl.signal.aborted) return;
          setRecommendation(rec);
          if (!cwd.trim() && rec.workspace) setCwd(rec.workspace);
          if (!touchedProtocol && rec.protocol) setProtocol(rec.protocol);
          if (!touchedRoster) setPeople(seatsFromRecommendation(rec));
          if (rec.readyCount === 0) setCustomize(true);
        })
        .catch(() => {
          // Offline / mock fallback: keep manual controls available.
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setRecommending(false);
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [rpc, title, cwd, protocol, touchedProtocol, touchedRoster, initialExpertCount]);

  function roster(next: Choice[]) {
    setTouchedRoster(true);
    setPeople(next);
  }
  function updateChair(next: Choice | null) {
    setTouchedRoster(true);
    setChair(next);
  }
  function change(i: number, a: DraftAgenda) {
    plan(agendas.map((v, j) => (j === i ? a : v)));
  }

  async function submit() {
    const promptText = title.trim();
    if (!promptText) return;
    const effectiveCwd = (cwd.trim() || recommendation?.workspace || "").trim();
    const manualAgendas = !askModerator && agendas.length > 0;
    const shouldPlan = askModerator && !manualAgendas;

    if (shouldPlan && !/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(effectiveCwd)) {
      setCustomize(true);
      setError(
        l("Choose an absolute workspace path.", "请选择项目或填写绝对路径。"),
      );
      return;
    }

    const useCustomPanel = touchedRoster || (!recommendation?.readyCount && people.length > 0);
    const moderator = chair || people[0] || null;
    const selected = useCustomPanel
      ? assignments(people, moderator, l("Moderator", "主持人"))
      : null;

    setError("");
    await perform(async () => {
      const domainTags = tags
        .split(/[,，]/)
        .map((x) => x.trim())
        .filter(Boolean);
      const res = await rpc.call<{ topic: Topic }>("council/convene", {
        prompt: promptText,
        ...(subtitle.trim() ? { subtitle: subtitle.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(domainTags.length ? { domain_tags: domainTags } : {}),
        ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
        protocol: protocol as CouncilProtocolId,
        ...(initialExpertCount && !useCustomPanel
          ? { expertCount: initialExpertCount }
          : {}),
        autoDispatch: shouldPlan && autoDispatch,
        planWithAi: shouldPlan,
        ...(questions.trim() ? { planningPrompt: questions.trim() } : {}),
        ...(selected
          ? {
              panelists: selected.panelists,
              moderator: selected.moderator,
              host: selected.host,
            }
          : {}),
        ...(manualAgendas
          ? {
              agendas: agendas.map((a) => ({
                title: a.title,
                sub_agendas: a.subs,
              })),
            }
          : {}),
      });
      close();
      navigate({
        topicId: res.topic.id,
        ...(effectiveCwd ? { projectCwd: effectiveCwd } : {}),
      });
    });
  }

  const previewSeats = touchedRoster
    ? people
    : recommendation?.panelists.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
      })) ?? [];
  const effectiveWorkspaceLabel =
    projects.find((p) => p.cwd === cwd)?.name ||
    recommendation?.workspaceLabel ||
    cwd.split(/[\\/]/).filter(Boolean).pop() ||
    "";

  return (
    <Modal title={l("New Council", "新建议题")} close={close} wide>
      <form
        className="council-wizard"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="full">
          {l("Title", "标题")}
          <textarea
            rows={2}
            ref={(input) => {
              // showModal uses the native autofocus attribute when it opens.
              if (input) input.autofocus = true;
            }}
            required
            maxLength={4000}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={l(
              "What should the council investigate? Paste a title or multi-line brief…",
              "输入议题或研究问题（支持多行背景，Cmd/Ctrl+Enter 直接开会）…",
            )}
          />
        </label>

        <section className="smart-preview" aria-busy={recommending}>
          <div className="smart-preview-head">
            <strong>
              {touchedRoster
                ? l("Custom expert panel", "自定义专家阵容")
                : l("Smart panel allocation", "智能专家分配")}
            </strong>
            <div className="tools">
              {effectiveWorkspaceLabel && (
                <span className="tag">{effectiveWorkspaceLabel}</span>
              )}
              <span className="tag">
                {protocols.find((p) => p.id === protocol)
                  ? l(
                      protocols.find((p) => p.id === protocol)!.name,
                      ["标准议事", "对抗辩论", "快速专家组"][
                        protocols.findIndex((p) => p.id === protocol)
                      ],
                    )
                  : protocol}
              </span>
              {touchedRoster && recommendation && recommendation.readyCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setTouchedRoster(false);
                    setChair(null);
                    setPeople(seatsFromRecommendation(recommendation));
                  }}
                >
                  {l("Reset smart defaults", "恢复智能分配")}
                </button>
              )}
            </div>
          </div>
          {previewSeats.length > 0 ? (
            <div className="seat-chips">
              {previewSeats.map((s) => (
                <span className="seat-chip" key={s.id}>
                  <b>{s.name || l("Expert", "专家")}</b>
                  {s.role && <small>{s.role}</small>}
                </span>
              ))}
            </div>
          ) : (
            <p className="small">
              {recommending
                ? l("Reading ready host agents…", "正在读取宿主已就绪 Agent…")
                : l(
                    "No ready host agents found automatically. Expand customization below to configure manually.",
                    "暂未自动检测到已就绪的宿主 Agent，请展开下方自定义配置。",
                  )}
            </p>
          )}
        </section>

        <label className="check">
          <input
            type="checkbox"
            checked={askModerator && autoDispatch}
            onChange={(e) => {
              setAutoDispatch(e.target.checked);
              if (e.target.checked) setAskModerator(true);
            }}
          />
          {l(
            "Auto-plan agendas and dispatch the opening round",
            "自动规划议程并派发首轮讨论",
          )}
        </label>

        <details
          className="customize-drawer"
          open={customize}
          onToggle={(e) => setCustomize(e.currentTarget.open)}
        >
          <summary>
            {l(
              "Customize seats, protocol & agendas",
              "自定义专家席位、协议与议程",
            )}
          </summary>

          <div className="form-grid council-details">
            <label>
              {l("Project workspace", "项目工作区")}
              <input
                aria-label={l("Project workspace", "项目工作区")}
                list="althing-project-choices"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
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
              {l("Discussion protocol", "讨论协议")}
              <select
                aria-label={l("Discussion protocol", "讨论协议")}
                value={protocol}
                onChange={(e) => {
                  setTouchedProtocol(true);
                  setProtocol(e.target.value);
                }}
              >
                {protocols.map((p, i) => (
                  <option key={p.id} value={p.id}>
                    {l(p.name, ["标准议事", "对抗辩论", "快速专家组"][i])}
                  </option>
                ))}
              </select>
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
          </div>

          <h3>{l("Expert panel", "专家组")}</h3>
          <RosterFields
            cwd={cwd}
            people={people}
            roster={roster}
            chair={chair}
            setChair={updateChair}
          />

          <h3>{l("Agendas", "议程")}</h3>
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
          {askModerator ? (
            <label>
              {l(
                "Which questions should the moderator consider?",
                "希望主持人优先讨论哪些问题？",
              )}
              <textarea
                rows={3}
                value={questions}
                onChange={(e) => setQuestions(e.target.value)}
              />
            </label>
          ) : (
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
                      onChange={(e) =>
                        change(i, { ...a, title: e.target.value })
                      }
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
        </details>

        {error && <p role="alert">{error}</p>}
        <footer className="form-footer">
          <button type="button" onClick={close}>
            {l("Cancel", "取消")}
          </button>
          <button className="primary" disabled={busy || !title.trim()}>
            {askModerator
              ? l("Convene council", "立即召开议会")
              : l("Create council", "创建议题")}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
