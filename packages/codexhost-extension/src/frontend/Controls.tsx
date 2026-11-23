import { useState } from "react";
import type { Agenda, SubAgenda, Topic } from "./types";
import { useL, useWorkspace } from "./context";
import { Modal } from "./ui";
import { roundPrompt, protocols } from "../backend/domain/protocols";

export function Runs({ topic, sub }: { topic: Topic; sub?: SubAgenda }) {
  const { runs, surface, rpc, perform, busy } = useWorkspace(),
    l = useL(),
    [link, setLink] = useState("");
  const visible = runs.filter((r) => !sub || r.subAgendaId === sub.id);
  if (!visible.length) return null;
  const translate = {
    queued: "排队中",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return (
    <section className="panel">
      <h2>{l("Delegated runs", "子会话")}</h2>
      {visible.map((r) => (
        <div className="run-card" key={r.id}>
          <div>
            <strong>
              {topic.panelists.find((p) => p.id === r.panelistId)?.name ||
                topic.moderator.name ||
                l("Moderator", "主持人")}
            </strong>
            <small>
              {[
                r.harnessId,
                typeof r.model === "string"
                  ? r.model
                  : [r.model?.id, r.model?.serviceTier]
                      .filter(Boolean)
                      .join(" · "),
                r.thinking,
              ]
                .filter(Boolean)
                .join(" / ")}
            </small>
          </div>
          <span className={"status " + r.status}>
            {l(r.status, translate[r.status])}
          </span>
          <p>{r.error || r.progressText}</p>
          <div className="tools">
            {r.threadId && (
              <button
                onClick={() => {
                  if (surface.openThread)
                    void perform(() => surface.openThread!(r.threadId!));
                  else
                    setLink(
                      "codex://threads/" + encodeURIComponent(r.threadId!),
                    );
                }}
              >
                {l("Open Thread", "打开子会话")}
              </button>
            )}
            {(["queued", "running"].includes(r.status) ||
              (!runs.some((next) => next.retryOf === r.id) &&
                ["failed", "cancelled"].includes(r.status))) && (
              <button
                disabled={busy || r.cancelRequested}
                onClick={() =>
                  void perform(() =>
                    rpc.call(
                      ["queued", "running"].includes(r.status)
                        ? "council/cancel-run"
                        : "council/retry-run",
                      { topicId: topic.id, runId: r.id },
                    ),
                  )
                }
              >
                {["queued", "running"].includes(r.status)
                  ? l("Cancel", "取消")
                  : l("Retry", "重试")}
              </button>
            )}
          </div>
        </div>
      ))}
      {link && (
        <Modal title={l("Open Thread", "打开子会话")} close={() => setLink("")}>
          <input
            aria-label={l("Thread link", "子会话链接")}
            value={link}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <button
            onClick={() =>
              void perform(() => navigator.clipboard.writeText(link))
            }
          >
            {l("Copy link", "复制链接")}
          </button>
        </Modal>
      )}
    </section>
  );
}
export function DispatchDialog({
  topic,
  sub,
  close,
}: {
  topic: Topic;
  sub: SubAgenda;
  close: () => void;
}) {
  const l = useL(),
    { perform, rpc, busy } = useWorkspace(),
    types = ["opening", "critique", "rebuttal", "synthesis_request", "custom"];
  const [type, setType] = useState<string>(
      protocols.find((p) => p.id === topic.protocol_id)?.default_phases[
        sub.dispatches.length
      ] || "opening",
    ),
    [people, setPeople] = useState(topic.panelists.map((p) => p.id)),
    [targets, setTargets] = useState<string[]>([]),
    [edited, edit] = useState<string | null>(null);
  const contributions = topic.agendas.flatMap((a) =>
    a.sub_agendas.flatMap((s) => s.contributions),
  );
  const prompt =
    edited ??
    roundPrompt(
      topic,
      sub,
      type,
      contributions.filter((c) => targets.includes(c.id)),
    );
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((v) => v !== id) : [...list, id];
  return (
    <Modal title={l("Dispatch round", "派发讨论")} close={close} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await perform(() =>
              rpc.call("council/dispatch-round", {
                topicId: topic.id,
                subAgendaId: sub.id,
                round_type: type,
                target_panelist_ids: people,
                target_contribution_ids: targets,
                ...(edited === null ? {} : { prompt_full: prompt }),
              }),
            )
          )
            close();
        }}
      >
        <label>
          {l("Round type", "轮次类型")}
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setTargets([]);
              edit(null);
            }}
          >
            {types.map((t, i) => (
              <option key={t} value={t}>
                {l(t, ["开场陈述", "质询", "反驳", "请求综述", "自定义"][i])}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>{l("Target experts", "目标专家")}</legend>
          {topic.panelists.map((p) => (
            <label className="check" key={p.id}>
              <input
                type="checkbox"
                checked={people.includes(p.id)}
                onChange={() => setPeople(toggle(people, p.id))}
              />
              {p.name}
            </label>
          ))}
        </fieldset>
        {["critique", "rebuttal"].includes(type) && (
          <fieldset>
            <legend>{l("Target contributions", "目标发言")}</legend>
            {contributions.map((c) => (
              <label className="check" key={c.id}>
                <input
                  type="checkbox"
                  checked={targets.includes(c.id)}
                  onChange={() => setTargets(toggle(targets, c.id))}
                />
                {c.panelist_name || c.panelist_id} · {c.summary}
              </label>
            ))}
          </fieldset>
        )}
        <label>
          {l("Public prompt", "公开提示词")}
          <textarea
            rows={8}
            required
            value={prompt}
            onChange={(e) => edit(e.target.value)}
          />
        </label>
        <footer className="form-footer">
          <button disabled={!people.length || busy} className="primary">
            {l("Send round", "派发本轮")}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function QuickEdit({
  kind,
  topic,
  agenda,
  sub,
  close,
}: {
  kind: string;
  topic: Topic;
  agenda?: Agenda;
  sub?: SubAgenda;
  close: () => void;
}) {
  const l = useL(),
    { rpc, busy, perform, navigate } = useWorkspace(),
    [name, setName] = useState(""),
    [body, setBody] = useState(
      kind === "update" ? sub?.synthesis_summary || "" : "",
    ),
    [mode, setMode] = useState("parallel"),
    [status, setStatus] = useState(sub?.status || "pending"),
    [pid, setPid] = useState(topic.panelists[0]?.id || "");
  const captions: Record<string, string> = {
    agenda: l("Add agenda", "添加议程"),
    sub: l("Add sub-agenda", "添加子议题"),
    update: l("Update sub-agenda", "更新子议题"),
    contribution: l("Record contribution", "记录发言"),
    delete: l("Delete council", "删除议题"),
  };
  async function submit() {
    const topicId = topic.id;
    if (kind === "delete") {
      await rpc.call("topics/delete", { topicId });
      navigate({});
    }
    if (kind === "agenda")
      await rpc.call("agendas/create", {
        topicId,
        data: { title: name, objective: body },
      });
    if (kind === "sub")
      await rpc.call("sub-agendas/create", {
        topicId,
        agendaId: agenda!.id,
        data: { title: name, prompt_framing: body, execution_mode: mode },
      });
    if (kind === "update")
      await rpc.call("sub-agendas/update", {
        topicId,
        subAgendaId: sub!.id,
        data: { status, synthesis_summary: body },
      });
    if (kind === "contribution")
      await rpc.call("contributions/create", {
        topicId,
        subAgendaId: sub!.id,
        data: {
          panelist_id: pid,
          summary: name,
          full_content: body,
          round_number: Math.max(
            1,
            ...sub!.dispatches.map((d) => d.round_number),
          ),
        },
      });
  }
  return (
    <Modal title={captions[kind]} close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await perform(submit)) close();
        }}
      >
        {kind === "delete" ? (
          <p>
            {l(
              "Permanently delete this council and its archives?",
              "永久删除此议题及其归档？",
            )}{" "}
            <strong>{topic.title}</strong>
          </p>
        ) : (
          <>
            {kind !== "update" && (
              <label>
                {kind === "contribution"
                  ? l("Summary", "摘要")
                  : l("Title", "标题")}
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            {kind === "contribution" && (
              <label>
                {l("Expert", "专家")}
                <select
                  required
                  value={pid}
                  onChange={(e) => setPid(e.target.value)}
                >
                  {topic.panelists.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {kind === "update" && (
              <label>
                {l("Status", "状态")}
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                >
                  {[
                    "pending",
                    "dispatching",
                    "in_progress",
                    "critiquing",
                    "completed",
                  ].map((s, i) => (
                    <option key={s} value={s}>
                      {l(
                        s,
                        ["待讨论", "派发中", "进行中", "质询中", "已完成"][i],
                      )}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              {kind === "contribution"
                ? l("Full text", "完整发言")
                : kind === "update"
                  ? l("Synthesis", "综述")
                  : l("Description", "说明")}
              <textarea
                value={body}
                required={kind === "contribution"}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            {kind === "sub" && (
              <label>
                {l("Execution", "执行方式")}
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="parallel">{l("Parallel", "并行")}</option>
                  <option value="sequential">{l("Sequential", "顺序")}</option>
                </select>
              </label>
            )}
          </>
        )}
        <footer className="form-footer">
          <button type="button" onClick={close}>
            {l("Cancel", "取消")}
          </button>
          <button className="primary" disabled={busy}>
            {kind === "delete"
              ? l("Confirm deletion", "确认删除")
              : l("Save", "保存")}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
