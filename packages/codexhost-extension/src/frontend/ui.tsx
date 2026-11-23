import { useL, useWorkspace } from "./context";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CouncilIcon } from "./CouncilIcon";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Check, ChevronDown, Circle, Package, X } from "lucide-react";

export function Markdown({ text }: { text?: string }) {
  if (!text) return null;
  const html = marked.parse(text, { async: false, gfm: true }) as string;
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "hr",
      "wbr",
      "b",
      "i",
      "s",
      "u",
      "mark",
      "strong",
      "em",
      "del",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "a",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "details",
      "summary",
      "sup",
      "sub",
    ],
    ALLOWED_ATTR: ["href", "title", "start", "align"],
    ALLOW_DATA_ATTR: false,
    RETURN_DOM: true,
  });
  for (const table of clean.querySelectorAll("table")) {
    const region = clean.ownerDocument.createElement("div");
    region.className = "table-scroll";
    region.setAttribute("role", "region");
    region.tabIndex = 0;
    table.replaceWith(region);
    region.append(table);
  }
  return (
    <div
      className="prose"
      onClick={(e) => {
        const a = (e.target as Element).closest("a");
        if (a) {
          e.preventDefault();
          if (/^https?:\/\//i.test(a.getAttribute("href") || ""))
            window.open(a.href, "_blank", "noopener,noreferrer");
        }
      }}
      dangerouslySetInnerHTML={{
        __html: clean.innerHTML,
      }}
    />
  );
}
export function Points({ items }: { items: string[] }) {
  return items.length ? (
    <ul className="points">
      {items.map((x, i) => (
        <li key={i}>
          <Markdown text={x} />
        </li>
      ))}
    </ul>
  ) : null;
}
export const labels: Record<string, string> = {
  draft: "草案",
  pending: "待讨论",
  dispatching: "派发中",
  in_progress: "进行中",
  critiquing: "交叉质询",
  synthesizing: "汇总中",
  completed: "已完成",
  archived: "已归档",
};
export function Status({ value }: { value: string }) {
  const l = useL();
  const Icon =
    value === "archived" ? Package : value === "completed" ? Check : Circle;
  return (
    <span className={"status " + value}>
      <Icon size={12} />
      {l(value.replaceAll("_", " "), labels[value] ?? value)}
    </span>
  );
}
export function Meter({ value }: { value: number }) {
  const l = useL();
  return (
    <div className="meter">
      <progress
        max={100}
        value={value}
        aria-label={l("Progress", "完成进度")}
      />
      <b>{value}%</b>
    </div>
  );
}
export function Live({ on }: { on: boolean }) {
  const l = useL();
  return (
    <span
      className={"live " + (on ? "on" : "")}
      title={
        on ? l("Host connected", "实时连接") : l("Host offline", "正在连接")
      }
    >
      <CouncilIcon name="live" size={25} />
      <span>
        {on ? l("Host connected", "实时连接") : l("Host offline", "正在连接")}
      </span>
    </span>
  );
}
export function Fold({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  const l = useL();
  const [open, set] = useState(false),
    id = useId();
  return (
    <div className="fold">
      <button
        aria-expanded={open}
        aria-controls={id}
        onClick={() => set(!open)}
      >
        <ChevronDown size={15} className={open ? "turned" : ""} />
        {open ? l("Hide full text", "收起原文") : summary}
      </button>
      <div className={"reveal " + (open ? "opened" : "")} id={id} inert={!open}>
        <div>{children}</div>
      </div>
    </div>
  );
}
export function Modal({
  title,
  close,
  children,
  wide = false,
  icon,
  actions,
}: {
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const l = useL();
  const { error } = useWorkspace();
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "wide" : ""}
      aria-labelledby={id}
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="dialog-in">
        <div className="dialog-head">
          <h2 id={id}>
            {icon}
            {title}
          </h2>
          {actions}
          <button
            className="icon"
            aria-label={l("Close", "关闭")}
            onClick={close}
          >
            <X />
          </button>
        </div>
        {error && (
          <p className="problem" role="alert">
            {error}
          </p>
        )}
        {children}
      </div>
    </dialog>
  );
}
export function expertColor(id: string, token = "", index = -1) {
  if (/^#[0-9a-f]{6}$/i.test(token)) return token;
  if (["primary", "live", "done"].includes(token))
    return "var(--" + token + ")";
  const colors = [
    "#3868a4",
    "#ac6734",
    "#457c68",
    "#9b5364",
    "#7362a4",
    "#467c86",
  ];
  if (index >= 0)
    return index < colors.length
      ? colors[index]
      : "hsl(" + (Math.round(index * 137.5) % 360) + " 44% 43%)";
  let h = 0;
  for (const c of id) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return colors[h % colors.length];
}
