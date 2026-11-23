import { useLayoutEffect, useRef, useState } from "react";
import type { Topic } from "./types";
import { useL, useWorkspace } from "./context";
import TopicNavigation, { type MeetingView } from "./TopicNavigation";
import CouncilVenue from "./CouncilVenue";
import { Discussion, type Target } from "./Discussion";
import { DispatchDialog, QuickEdit, Runs } from "./Controls";
import { ReportReader } from "./ReportReader";
import { Markdown, Points, Meter, Status, expertColor } from "./ui";
import "./plugins/builtins";
import { plugins } from "./plugins/registry";
import { Overview } from "./Overview";
import type { Destination } from "./host";
export function TopicPage({
  topic: t,
  initial,
}: {
  topic: Topic;
  initial: Destination;
}) {
  const l = useL(),
    { rpc, busy, perform } = useWorkspace(),
    root = useRef<HTMLElement>(null),
    [view, setView] = useState<MeetingView>(() => {
      try {
        return localStorage.getItem("althing.meeting-view") === "reading"
          ? "reading"
          : "venue";
      } catch {
        return "venue";
      }
    }),
    [tab, setTab] = useState(initial.tab || "overview"),
    [subId, setSub] = useState(initial.sub || ""),
    [dialog, show] = useState(""),
    [report, setReport] = useState(initial.reportId || "");
  const a = t.agendas.find((a) => a.id === tab),
    s = a?.sub_agendas.find((s) => s.id === subId) || a?.sub_agendas[0];
  const extra = plugins.tabs.find((p) => "plugin:" + p.id === tab),
    Extra = extra?.component;
  const [response, focus] = useState("");
  useLayoutEffect(() => {
    if (response) {
      const shadow = root.current?.getRootNode() as ShadowRoot;
      shadow
        ?.getElementById("response-" + response)
        ?.scrollIntoView?.({ block: "center" });
      focus("");
    }
  }, [response]);
  function pick(id: string, sub = "") {
    setTab(id);
    setSub(sub);
  }
  const call = (method: string, params = {}) =>
    void perform(() => rpc.call(method, { topicId: t.id, ...params }));
  const targets = new Map<string, Target>();
  for (const a of t.agendas)
    for (const s of a.sub_agendas)
      for (const c of s.contributions)
        targets.set(c.id, {
          c,
          agenda: a.id,
          sub: s.id,
          color: expertColor(c.panelist_id),
        });
  const reports =
    tab === "final"
      ? t.reports.filter((r) => !r.agenda_id)
      : a
        ? t.reports.filter((r) => r.agenda_id === a.id)
        : t.reports;
  return (
    <main className="topic-body" ref={root}>
      <TopicNavigation
        topic={t}
        view={view}
        tab={tab}
        onView={(v) => {
          setView(v);
          try {
            localStorage.setItem("althing.meeting-view", v);
          } catch {}
          if (tab === "final" || Extra) pick("overview");
        }}
        onSelect={(id) => pick(id)}
        actions={
          <>
            <details className="action-menu">
              <summary>{l("Council actions", "议题操作")}</summary>
              <div className="panel tools">
                <button
                  disabled={busy}
                  onClick={() => call("council/plan-topic")}
                >
                  {l("AI agenda planning", "AI 规划议程")}
                </button>
                <button onClick={() => show("agenda")}>
                  {l("Add agenda", "添加议程")}
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    call("council/generate-report", { completeTopic: true })
                  }
                >
                  {l("Generate final report", "生成总报告")}
                </button>
                <button disabled={busy} onClick={() => call("archives/create")}>
                  {l("Create archive", "创建归档")}
                </button>
                {["archive-zip", "standalone-html", "markdown-bundle"].map(
                  (format) => (
                    <button
                      disabled={busy}
                      key={format}
                      onClick={() =>
                        void perform(() =>
                          rpc.download({ topicId: t.id, format }),
                        )
                      }
                    >
                      {l("Export", "导出")} {format}
                    </button>
                  ),
                )}
                <button onClick={() => show("delete")}>
                  {l("Delete council", "删除议题")}
                </button>
              </div>
            </details>
            {plugins.actions.map(({ id, component: Action }) => (
              <Action topic={t} key={id} />
            ))}
          </>
        }
      />
      {view === "venue" && !["final", "plugin:roster"].includes(tab) && (
        <CouncilVenue
          topic={t}
          agenda={a}
          sub={s}
          onEnter={pick}
          onLobby={() => pick("overview")}
        />
      )}
      {tab === "overview" && (
        <>
          <section className="panel">
            <h2>{l("Council brief", "议题概览")}</h2>
            <Markdown text={t.subtitle} />
            <Markdown text={t.description} />
            <div className="tools">
              {t.domain_tags.map((tag) => (
                <span className="tag" key={tag}>
                  {tag}
                </span>
              ))}
            </div>

            {!t.agendas.length && (
              <div className="tools">
                <button onClick={() => show("agenda")}>
                  {l("Add first agenda", "添加首个议程")}
                </button>
                <button
                  disabled={busy}
                  onClick={() => call("council/plan-topic")}
                >
                  {l("Plan with AI", "使用 AI 规划")}
                </button>
              </div>
            )}
          </section>
          {view === "reading" ? (
            <Overview topic={t} select={pick} open={setReport} />
          ) : (
            <details className="meeting-records">
              <summary>
                {l("Agenda progress and minutes", "议程进展与会议记录")}
              </summary>
              <Overview topic={t} select={pick} open={setReport} />
            </details>
          )}
        </>
      )}
      {a && (
        <section className="panel">
          <h2>{a.title}</h2>
          <Markdown text={a.objective} />
          <Meter value={a.progress_pct} />
          <div className="tools">
            {a.sub_agendas.map((sub) => (
              <button
                aria-pressed={s?.id === sub.id}
                key={sub.id}
                onClick={() => setSub(sub.id)}
              >
                {sub.title} · {sub.progress_pct}%
              </button>
            ))}
            <button onClick={() => show("sub")}>
              + {l("Add sub-agenda", "添加子议题")}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                call("council/conclude-agenda", {
                  agendaId: a.id,
                  publishReport: true,
                })
              }
            >
              {l("Conclude agenda and publish report", "生成议程结论与报告")}
            </button>
          </div>
          <Markdown text={a.conclusion_summary} />
          <Points items={a.conclusion_key_points} />
          {!!a.open_disagreements.length && (
            <>
              <h3>{l("Open disagreements", "未决分歧")}</h3>
              <Points items={a.open_disagreements} />
            </>
          )}
        </section>
      )}
      {s && (
        <>
          <section className="panel">
            <div className="card-heading">
              <h2>{s.title}</h2>
              <Status value={s.status} />
            </div>
            <div className="tools">
              <button
                className="primary"
                disabled={busy}
                onClick={() => show("dispatch")}
              >
                {l("Dispatch round", "派发讨论")}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  call("council/synthesize-sub-agenda", { subAgendaId: s.id })
                }
              >
                {l("Synthesize", "主持人综述")}
              </button>
              <button onClick={() => show("update")}>
                {l("Update sub-agenda", "更新子议题")}
              </button>
              <button onClick={() => show("contribution")}>
                {l("Record contribution", "记录发言")}
              </button>
            </div>
          </section>
          <Discussion
            s={s}
            moderator={t.moderator}
            targets={targets}
            jump={(target) => {
              pick(target.agenda, target.sub);
              focus(target.c.id);
            }}
          />
        </>
      )}
      {Extra && <Extra topic={t} />}
      <Runs topic={t} sub={s} />
      {(reports.length > 0 || tab === "final") && (
        <section className="panel">
          <h2>{l("Reports", "报告")}</h2>
          {reports.map((r) => (
            <button key={r.id} onClick={() => setReport(r.id)}>
              {r.title} · v{r.version}
            </button>
          ))}
          {!reports.length && (
            <p>{l("No report published yet.", "尚无已发布的报告。")}</p>
          )}
        </section>
      )}
      {tab === "overview" && t.archives.length > 0 && (
        <section className="panel">
          <h2>{l("Archives", "归档")}</h2>
          {t.archives.map((a) => (
            <button
              key={a.id}
              onClick={() =>
                void perform(() =>
                  rpc.download({ topicId: t.id, archiveId: a.id }),
                )
              }
            >
              {a.title} · {a.created_at.slice(0, 10)}
            </button>
          ))}
        </section>
      )}
      {dialog === "dispatch" && s ? (
        <DispatchDialog topic={t} sub={s} close={() => show("")} />
      ) : (
        dialog && (
          <QuickEdit
            kind={dialog}
            topic={t}
            agenda={a}
            sub={s}
            close={() => show("")}
          />
        )
      )}
      {report && (
        <ReportReader
          key={report}
          topicId={t.id}
          id={report}
          close={() => setReport("")}
        />
      )}
    </main>
  );
}
