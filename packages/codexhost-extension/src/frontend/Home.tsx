import { useRef, useState } from "react";
import { ArrowRight, Plus, Search, Upload } from "lucide-react";
import { useAssets, useL, useWorkspace } from "./context";
import type { Card } from "./types";
import { workspaceKey, activeCouncil } from "./host";
import { Meter, Status } from "./ui";
export function Home({
  cards,
  cwd,
  setCwd,
  create,
}: {
  cards: Card[];
  cwd: string;
  setCwd: (s: string) => void;
  create: () => void;
}) {
  const l = useL(),
    assets = useAssets(),
    { projects, rpc, perform, navigate, busy } = useWorkspace(),
    file = useRef<HTMLInputElement>(null);
  const [q, search] = useState(""),
    [filter, choose] = useState("all");
  const visible = cards.filter(
    (t) =>
      (!cwd || workspaceKey(cwd) === workspaceKey(t.projectCwd)) &&
      (filter === "all" ||
        (filter === "live" ? activeCouncil(t) : t.status === filter)) &&
      [t.title, t.subtitle, t.description, t.projectLabel, ...t.domain_tags]
        .join(" ")
        .toLowerCase()
        .includes(q.toLowerCase()),
  );
  return (
    <main className="hub">
      <section className="hero">
        <div className="hero-intro">
          <h1>{l("The Althing", "议事厅")}</h1>
          <p>{l("Multi-agent research councils", "多智能体研究议事厅")}</p>
        </div>
        {assets["council.webp"] && (
          <img className="council-art" src={assets["council.webp"]} alt="" />
        )}
        <div className="hero-stats">
          {[
            [cards.length, l("Councils", "议题")],
            [cards.filter(activeCouncil).length, l("Live", "进行中")],
            [
              cards.reduce((n, c) => n + c.report_count, 0),
              l("Reports", "报告"),
            ],
          ].map(([n, label]) => (
            <div key={label}>
              <strong>{n}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>
      <div className="tools hub-tools">
        <select
          aria-label={l("Project filter", "项目筛选")}
          value={
            projects.find((p) => workspaceKey(p.cwd) === workspaceKey(cwd))
              ?.cwd || ""
          }
          onChange={(e) => setCwd(e.target.value)}
        >
          <option value="">{l("All projects", "全部项目")}</option>
          {projects.map((p) => (
            <option key={p.cwd} value={p.cwd}>
              {p.name} · {p.cwd}
            </option>
          ))}
        </select>
        <button className="primary" onClick={create}>
          <Plus size={17} />
          {l("New Council", "新建议题")}
        </button>
        <button disabled={busy} onClick={() => file.current?.click()}>
          <Upload size={16} />
          {l("Import ZIP", "导入归档")}
        </button>
        <input
          aria-label={l("Archive file", "归档文件")}
          ref={file}
          type="file"
          hidden
          accept=".zip"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f)
              void perform(async () => {
                const r = await rpc.upload(f);
                navigate({ topicId: r.topicId });
              });
          }}
        />
      </div>
      <div className="controls">
        <div className="filters">
          {["all", "live", "completed", "archived", "draft"].map((f, i) => (
            <button
              key={f}
              aria-pressed={f === filter}
              className={f === filter ? "chosen" : ""}
              onClick={() => choose(f)}
            >
              {l(
                ["All", "Live", "Completed", "Archived", "Draft"][i],
                ["全部", "进行中", "已完成", "已归档", "草案"][i],
              )}
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={17} />
          <input
            aria-label={l("Search councils", "搜索议题")}
            placeholder={l("Search councils", "搜索议题")}
            value={q}
            onChange={(e) => search(e.target.value)}
          />
        </label>
      </div>
      <div className="card-grid">
        {visible.map((t) => (
          <article className="topic-card" key={t.id}>
            {assets["research.webp"] && (
              <img
                className="topic-art"
                src={
                  assets[
                    ["archived", "completed"].includes(t.status)
                      ? "report.webp"
                      : "research.webp"
                  ]
                }
                alt=""
              />
            )}
            <div className="card-copy">
              <div className="card-heading">
                <Status value={t.status} />
                <h2>{t.title}</h2>
              </div>
              <p className="subtitle">{t.subtitle || t.description}</p>
              <div className="tools">
                {[t.projectLabel, ...t.domain_tags]
                  .filter(Boolean)
                  .map((tag, i) => (
                    <span className="tag" key={i}>
                      {tag}
                    </span>
                  ))}
              </div>
              <p>{t.current_activity}</p>
              <Meter value={t.progress_pct} />
            </div>
            <div className="statline">
              <span>
                {l("Agendas", "议程")}{" "}
                <b>
                  {t.completed_agendas}/{t.agenda_count}
                </b>
              </span>
              <span>
                {l("Contributions", "发言")} <b>{t.contribution_count}</b>
              </span>
              <span>
                {l("Reports", "报告")} <b>{t.report_count}</b>
              </span>
            </div>
            <button onClick={() => navigate({ topicId: t.id })}>
              {l("Enter council", "进入议题")}
              <ArrowRight size={16} />
            </button>
          </article>
        ))}
      </div>
      {!visible.length && (
        <div className="empty">
          {l("No councils match this view.", "当前视图暂无议题。")}
        </div>
      )}
    </main>
  );
}
