import { ArrowRight, ChevronRight, Users } from "lucide-react";
import { CouncilIcon } from "./CouncilIcon";
import { Markdown, Meter, Points, Status } from "./ui";
import { useAssets, useL, useWorkspace } from "./context";
import { Roster } from "./plugins/builtins";
import type { Topic } from "./types";
type OpenReport = (id: string) => void;
const reportButton = (id: string | null, open: OpenReport, label: string) =>
  id && (
    <button className="link-button" onClick={() => open(id)}>
      <CouncilIcon name="report" size={17} />
      {label}
      <ArrowRight size={14} />
    </button>
  );
export function Overview({
  topic: t,
  select,
  open,
}: {
  topic: Topic;
  select: (id: string) => void;
  open: OpenReport;
}) {
  const l = useL(),
    assets = useAssets(),
    { rpc, perform } = useWorkspace();
  const finished = ["completed", "archived"].includes(t.status);
  return (
    <div className="overview">
      {finished && (
        <section className="panel lead executive">
          <img className="executive-art" src={assets["report.webp"]} alt="" />
          <div className="summary-copy">
            <div className="row spread">
              <h2>{l("Executive summary", "执行摘要")}</h2>
              <Status value={t.status} />
            </div>
            <Markdown text={t.executive_summary} />
          </div>
          <div className="summary-points">
            <h3>{l("Key takeaways", "关键结论")}</h3>
            <Points
              items={
                t.key_takeaways.length
                  ? t.key_takeaways
                  : t.agendas.flatMap((a) => a.conclusion_key_points)
              }
            />
          </div>
          <div className="summary-actions">
            {reportButton(
              t.final_report_id,
              open,
              l("Open final report", "打开总报告"),
            )}
            {t.archives.at(-1) && (
              <button
                onClick={() =>
                  void perform(() =>
                    rpc.download({
                      topicId: t.id,
                      archiveId: t.archives.at(-1)!.id,
                    }),
                  )
                }
              >
                <CouncilIcon name="download" size={19} />
                {l("Download archive", "下载归档")}
              </button>
            )}
          </div>
        </section>
      )}
      <section className="panel agenda-index">
        <div className="section-title">
          <h2>
            <CouncilIcon
              name={finished ? "report" : "capabilities"}
              size={29}
            />
            {finished
              ? l("Agenda conclusions", "议程结论矩阵")
              : l("Agenda progress", "议程进展")}
          </h2>
          <span>
            {t.completed_agendas} / {t.agenda_count} {l("complete", "完成")}
          </span>
        </div>
        {!t.agendas.length && (
          <p className="panel muted">
            {l("Waiting for the first agenda.", "等待主持人发布议程。")}
          </p>
        )}
        {finished ? (
          <div className="table-wrap">
            <table aria-label={l("Agenda conclusions", "议程结论矩阵")}>
              <thead>
                <tr>
                  <th>{l("Agenda", "议程")}</th>
                  <th>{l("Conclusions and findings", "结论与要点")}</th>
                  <th>{l("Open disagreements", "未决分歧")}</th>
                  <th>{l("Report", "报告")}</th>
                </tr>
              </thead>
              <tbody>
                {t.agendas.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => select(a.id)}
                      >
                        {a.code} · {a.title}
                      </button>
                    </td>
                    <td>
                      <Markdown text={a.conclusion_summary} />
                      <Points items={a.conclusion_key_points} />
                    </td>
                    <td>
                      {a.open_disagreements.length ? (
                        <Points items={a.open_disagreements} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {reportButton(a.report_id, open, l("Read", "阅读")) ||
                        "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="agenda-grid">
            {t.agendas.map((a) => {
              const active = a.sub_agendas.filter((s) =>
                ["in_progress", "critiquing", "dispatching"].includes(s.status),
              );
              const ids = new Set(
                active.flatMap((s) => [
                  ...s.dispatches.flatMap((d) => d.target_panelist_ids),
                  ...s.contributions.map((c) => c.panelist_id),
                ]),
              );
              return (
                <section key={a.id} className="agenda-line">
                  <button className="agenda-link" onClick={() => select(a.id)}>
                    {a.code}　{a.title}
                    <ChevronRight size={15} />
                  </button>
                  <Status value={a.status} />
                  <Markdown text={a.current_activity || a.objective} />
                  <span className="small">
                    {
                      a.sub_agendas.filter((s) => s.status === "completed")
                        .length
                    }{" "}
                    / {a.sub_agendas.length}{" "}
                    {l("sub-agendas complete", "子议题完成")}
                  </span>
                  <Meter value={a.progress_pct} />
                  {ids.size > 0 && (
                    <div className="chips">
                      {[...ids].map((id) => (
                        <span className="tag" key={id}>
                          {t.panelists.find((p) => p.id === id)?.name ?? id}
                        </span>
                      ))}
                    </div>
                  )}
                  {reportButton(
                    a.report_id,
                    open,
                    l("Agenda report", "议程报告"),
                  )}
                </section>
              );
            })}
          </div>
        )}
      </section>
      <section className="panel">
        <h2>
          <Users size={21} />
          {l("Expert roster", "专家名册")}
        </h2>
        <Roster people={t.panelists} />
      </section>
      {finished && t.reports.length > 0 && (
        <section className="panel report-index">
          <h2>
            <CouncilIcon name="report" size={26} />
            {l("Report index", "报告目录")}
          </h2>
          {t.reports.map((r) => (
            <div key={r.id}>{reportButton(r.id, open, r.title)}</div>
          ))}
        </section>
      )}
    </div>
  );
}
