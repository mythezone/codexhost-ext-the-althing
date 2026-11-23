import {
  startTransition,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import type { Topic, SubAgenda } from "./types";
import { useL, useWorkspace } from "./context";
import TopicNavigation from "./TopicNavigation";
import { Discussion, type Target } from "./Discussion";
import { DispatchDialog, QuickEdit, Runs } from "./Controls";
import { RosterEditor } from "./RosterEditor";
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
    [tab, setTab] = useState(initial.tab || "overview"),
    [subId, setSub] = useState(initial.sub || ""),
    [dialog, show] = useState(""),
    [report, setReport] = useState(initial.reportId || "");
  const a = t.agendas.find((a) => a.id === tab),
    s = a?.sub_agendas.find((s) => s.id === subId) || a?.sub_agendas[0];
  const extra = plugins.tabs.find((p) => "plugin:" + p.id === tab),
    Extra = extra?.component;
  const [printSub, setPrintSub] = useState<SubAgenda>();
  const previousDestination = useRef(initial);
  useLayoutEffect(() => {
    if (previousDestination.current === initial) return;
    previousDestination.current = initial;
    setPrintSub(undefined);
    setTab(initial.tab || "overview");
    setSub(initial.sub || "");
    setReport(initial.reportId || "");
    show("");
  }, [initial]);
  useEffect(() => {
    const clear = () => setPrintSub(undefined);
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, []);
  async function printAgenda() {
    if (!s) {
      window.print();
      return;
    }
    const section = root.current?.querySelector(".discussion");
    let printable = s;
    if (
      s.contributions.some((c) => c.full_content_length) ||
      s.dispatches.some((d) => d.prompt_full_length)
    ) {
      const full = await rpc.call<Topic>("topics/get", { topicId: t.id });
      printable = full.agendas
        .flatMap((a) => a.sub_agendas)
        .find((sub) => sub.id === s.id)!;
    }
    if (!printable || !section?.isConnected) return;
    flushSync(() => setPrintSub(printable));
    window.print();
  }
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
    startTransition(() => {
      setTab(id);
      setSub(sub);
      setPrintSub(undefined);
    });
  }
  const call = (method: string, params = {}) =>
    void perform(() => rpc.call(method, { topicId: t.id, ...params }));
  const targets = useMemo(() => {
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
    return targets;
  }, [t.agendas]);
  const reports =
    tab === "final"
      ? t.reports.filter((r) => !r.agenda_id)
      : a
        ? t.reports.filter((r) => r.agenda_id === a.id)
        : t.reports;
  return (
    <main
      className="topic-body"
      ref={root}
      onKeyDown={(e) => {
        if (
          (e.ctrlKey || e.metaKey) &&
          e.key.toLowerCase() === "p" &&
          !report
        ) {
          e.preventDefault();
          void perform(printAgenda);
        }
      }}
    >
      <TopicNavigation
        topic={t}
        tab={tab}
        onSelect={(id) => pick(id)}
        actions={
          <>
            <details className="action-menu">
              <summary>{l("Council actions", "议题操作")}</summary>
              <div className="panel tools">
                {t.status !== "archived" && (
                  <button onClick={() => show("roles")}>
                    {l("Configure roles & agents", "配置专家与角色")}
                  </button>
                )}
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
              <Action
                topic={t}
                key={id}
                onPrint={() => void perform(printAgenda)}
              />
            ))}
          </>
        }
      />
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
          <Overview topic={t} select={pick} open={setReport} />
        </>
      )}
      {a && (
        <section className="panel">
          <h2>{a.title}</h2>
          <Markdown text={a.objective} />
          <Meter value={a.progress_pct} />
          <div className="tools resource-actions">
            {a.sub_agendas.map((sub) => (
              <button
                aria-pressed={s?.id === sub.id}
                key={sub.id}
                onClick={() => pick(tab, sub.id)}
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
            key={s.id}
            print={printSub?.id === s.id}
            s={printSub?.id === s.id ? printSub : s}
            moderator={t.moderator}
            targets={targets}
            jump={(target) => {
              startTransition(() => {
                pick(target.agenda, target.sub);
                focus(target.c.id);
              });
            }}
          />
        </>
      )}
      {Extra && <Extra topic={t} configure={() => show("roles")} />}
      <Runs topic={t} sub={s} />
      {(reports.length > 0 || tab === "final") && (
        <section className="panel">
          <h2>{l("Reports", "报告")}</h2>
          <div className="tools resource-actions">
            {reports.map((r) => (
              <button key={r.id} onClick={() => setReport(r.id)}>
                {r.title} · v{r.version}
              </button>
            ))}
          </div>
          {!reports.length && (
            <p>{l("No report published yet.", "尚无已发布的报告。")}</p>
          )}
        </section>
      )}
      {tab === "overview" && t.archives.length > 0 && (
        <section className="panel">
          <h2>{l("Archives", "归档")}</h2>
          <div className="tools resource-actions">
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
          </div>
        </section>
      )}
      {dialog === "roles" ? (
        <RosterEditor topic={t} close={() => show("")} />
      ) : dialog === "dispatch" && s ? (
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
