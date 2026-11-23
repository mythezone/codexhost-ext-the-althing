import { useL, useWorkspace } from "./context";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, ScrollText, UsersRound } from "lucide-react";
import { CouncilIcon } from "./CouncilIcon";
import { Status } from "./ui";
import { plugins } from "./plugins/registry";
import type { Card, Topic } from "./types";

function TempleMark() {
  return (
    <svg
      viewBox="0 0 38 36"
      width="31"
      height="29"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <g className="temple-roof">
        <path d="M3 12 19 4l16 8v2H3z" fill="var(--sky)" />
        <path d="M9 11.5 19 7l10 4.5" />
        <circle cx="19" cy="10.5" r="1.6" fill="var(--sun)" stroke="none" />
      </g>
      <path
        d="M7 16h4v12H7zm10 0h4v12h-4zm10 0h4v12h-4z"
        fill="var(--icon-paper)"
      />
      <path d="M5 28h28v3H5zm-2 3h32v2H3z" fill="var(--sky)" />
    </svg>
  );
}

function ProgressDial({ value }: { value: number }) {
  const l = useL();
  return (
    <span
      className="council-dial"
      aria-label={`${l("Progress", "整体进度")} ${value}%`}
    >
      <svg viewBox="0 0 30 30" aria-hidden="true">
        <circle
          cx="15"
          cy="15"
          r="11"
          fill="none"
          stroke="var(--line)"
          strokeWidth="4"
        />
        <circle
          className="dial-fill"
          cx="15"
          cy="15"
          r="11"
          fill="none"
          stroke="var(--primary)"
          strokeWidth="4"
          strokeLinecap="round"
          pathLength="100"
          strokeDasharray={`${value} 100`}
          transform="rotate(-90 15 15)"
        />
      </svg>
      {value}%
    </span>
  );
}

type Props = {
  topic: Card | Topic;
  tab: string;
  onSelect: (id: string) => void;
  actions: ReactNode;
};

export default function TopicNavigation({
  topic: t,
  tab,
  onSelect,
  actions,
}: Props) {
  const l = useL();
  const { navigate } = useWorkspace();
  const menu = useRef<HTMLDetailsElement>(null);
  const [expanded, setExpanded] = useState(false);
  const activity = t.current_activity;
  const agendas = "agendas" in t ? t.agendas : [];
  const agenda = agendas.find((a) => a.id === tab);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        menu.current?.open &&
        event.target instanceof Node &&
        !event.composedPath().includes(menu.current)
      )
        menu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const select = (id: string) => {
    if (menu.current?.open) {
      menu.current.open = false;
      menu.current.querySelector("summary")?.focus();
    }
    onSelect(id);
  };
  const link = (id: string, label: string, icon: ReactNode) => (
    <button
      type="button"
      key={id}
      aria-current={tab === id ? "page" : undefined}
      className="council-nav-link"
      onClick={() => select(id)}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
  return (
    <header className="council-head">
      <div className="council-breadcrumb">
        <button onClick={() => navigate({})}>
          <ArrowLeft size={15} />
          {l("Councils", "议题广场")}
        </button>
        <span className="crumb-divider" aria-hidden="true">
          /
        </span>
        <Status value={t.status} />
        <div className="council-head-actions">{actions}</div>
      </div>
      <h1>{t.title}</h1>
      <div className="council-activity-row">
        <ProgressDial value={t.progress_pct} />
        {activity && (
          <button
            type="button"
            className="council-activity"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            title={
              expanded
                ? l("Collapse activity", "收起当前进展")
                : l("Expand activity", "展开当前进展")
            }
          >
            <span className="activity-label">
              {l("Current activity", "当前进展")}
            </span>
            <span className="activity-copy">{activity}</span>
            <ChevronDown size={15} />
          </button>
        )}
      </div>
      <div className="council-navigation">
        <nav
          className="council-nav"
          aria-label={l("Council navigation", "议题导航")}
        >
          {link("overview", l("Overview", "总览"), <TempleMark />)}
          {!("agendas" in t) && t.agenda_count > 0 && (
            <button className="council-nav-link" disabled>
              {l("Agendas", "议程")} · {t.agenda_count}
            </button>
          )}
          {agendas.length > 0 && (
            <details className="council-agendas" ref={menu}>
              <summary
                className={agenda ? "chosen-agenda" : ""}
                aria-label={l("Choose agenda", "选择议程")}
              >
                <CouncilIcon name="layers" size={20} />
                <span>{l("Agendas", "议程")}</span>
                <small>{agenda?.code || agendas.length}</small>
                <ChevronDown size={14} />
              </summary>
              <div className="council-agenda-list">
                {agendas.map((a, i) => (
                  <button
                    type="button"
                    key={a.id}
                    onClick={() => select(a.id)}
                    aria-current={a.id === tab ? "page" : undefined}
                  >
                    <span className="agenda-letter">{a.code || i + 1}</span>
                    <span>{a.title}</span>
                    <small>{a.progress_pct}%</small>
                  </button>
                ))}
              </div>
            </details>
          )}
          {link(
            "final",
            l("Final reports", "总报告"),
            <ScrollText size={19} />,
          )}
          {plugins.tabs.map((p) =>
            link(
              "plugin:" + p.id,
              l("Expert roster", p.label),
              <UsersRound size={19} />,
            ),
          )}
        </nav>
      </div>
    </header>
  );
}
