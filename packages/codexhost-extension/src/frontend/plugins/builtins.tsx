import { hostRoster } from "../AgentPicker";
import { thinkingLabel } from "../../shared/agents";
import { useL } from "../context";
import { ShieldCheck, Users } from "lucide-react";
import { plugins } from "./registry";
import type { Expert } from "../types";
import { AgentAvatar } from "../AgentAvatar";
import { CouncilIcon } from "../CouncilIcon";
import { Markdown } from "../ui";
export function Roster({ people }: { people: Expert[] }) {
  const l = useL();
  return (
    <div
      className="table-scroll"
      role="region"
      aria-label={l("Expert roster", "专家名册")}
      tabIndex={0}
    >
      <table
        className="roster-table"
        aria-label={l("Expert roster", "专家名册")}
      >
        <thead>
          <tr>
            {["专家", "模型", "订阅来源", "推理强度", "角色"].map((x, i) => (
              <th key={x}>
                {l(
                  ["Expert", "Model", "Subscription", "Thinking", "Role"][i],
                  x,
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id}>
              {[
                p.name,
                p.model,
                p.subscription || p.provider,
                thinkingLabel(p.reasoning_effort),
                p.role,
              ].map((v, i) => (
                <td key={i}>
                  {i === 0 ? (
                    <span className="roster-name">
                      <AgentAvatar {...p} size={27} />
                      {v || "—"}
                    </span>
                  ) : v ? (
                    <span className={"roster-cell cell-" + i}>{v}</span>
                  ) : (
                    "—"
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
plugins.register("tabs", {
  id: "roster",
  label: (l) => l("Expert roster", "专家名册"),
  component: ({ topic, configure }) => {
    const l = useL(),
      host = hostRoster(topic);
    return (
      <section className="panel">
        <h2>
          <Users />
          {l("Expert roster", "专家名册")}
        </h2>
        {topic.status !== "archived" && (
          <button onClick={configure}>
            {l("Configure roles & agents", "配置专家与角色")}
          </button>
        )}
        <p>
          <strong>{l("Moderator", "主持人")}</strong> ·{" "}
          {[
            topic.moderator.provider ||
              host.moderator_config?.harnessId ||
              l("Host default", "宿主默认"),
            topic.moderator.model,
            thinkingLabel(
              host.moderator_display?.reasoning_effort ||
                host.moderator_config?.thinking ||
                "",
            ),
            host.moderator_display?.role,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <Roster people={topic.panelists} />
      </section>
    );
  },
});
plugins.register("contributions", {
  id: "verification",
  label: (l) => l("Verification", "验证意见"),
  matches: (c) => c.kind === "verification",
  component: ({ contribution }) => (
    <>
      <strong className="verify">
        <ShieldCheck size={16} />
        {useL()("Verification", "验证意见")}
      </strong>
      <Markdown text={contribution.summary} />
    </>
  ),
});
plugins.register("actions", {
  id: "print",
  label: (l) => l("Print", "打印"),
  component: ({ onPrint }) => (
    <button
      className="icon"
      title={useL()("Print agenda", "打印当前议程")}
      aria-label={useL()("Print agenda", "打印当前议程")}
      onClick={onPrint}
    >
      <CouncilIcon name="print" size={19} />
      <span>{useL()("Print", "打印")}</span>
    </button>
  ),
});
plugins.register("widgets", {
  id: "version",
  label: (l) => l("Report version", "报告版本"),
  component: ({ report }) => <span className="tag">v{report.version}</span>,
});
