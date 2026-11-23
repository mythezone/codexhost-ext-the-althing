import { useL } from "./context";
import type { CSSProperties } from "react";
import { BadgeCheck, Hash, Reply } from "lucide-react";
import { AgentAvatar } from "./AgentAvatar";
import { plugins } from "./plugins/registry";
import type { Contribution, SubAgenda, Topic } from "./types";
import { Fold, Markdown, Points } from "./ui";

export type Target = {
  c: Contribution;
  agenda: string;
  sub: string;
  color: string;
};

function ResponseCard({
  c,
  targets,
  jump,
}: {
  c: Contribution;
  targets: Map<string, Target>;
  jump: (target: Target) => void;
}) {
  const l = useL();
  const Renderer = plugins.contributions.find((p) => p.matches(c))?.component;
  const name = c.panelist_name || c.panelist_id;
  const metadata = [c.model, c.subscription, c.reasoning_effort].filter(
    Boolean,
  );
  return (
    <article
      id={"response-" + c.id}
      className="panel response"
      style={{ "--expert": targets.get(c.id)?.color } as CSSProperties}
    >
      <div className="speech-identity">
        <AgentAvatar
          name={name}
          id={c.panelist_id}
          model={c.model}
          provider={c.provider}
        />
        <div className="speech-byline">
          <div className="speech-author">
            <strong>{name}</strong>
            {c.role && (
              <span className="speech-role">
                <BadgeCheck size={13} aria-hidden="true" />
                {c.role}
              </span>
            )}
          </div>
          {metadata.length > 0 && (
            <span className="speech-meta">{metadata.join(" · ")}</span>
          )}
        </div>
      </div>
      <div className="response-body">
        {c.target_contribution_ids.map((id) => {
          const target = targets.get(id);
          return (
            target && (
              <button className="reply" key={id} onClick={() => jump(target)}>
                <Reply size={14} aria-hidden="true" />
                {l("Reply to", "回应")}{" "}
                {target.c.panelist_name || target.c.panelist_id} · Round{" "}
                {target.c.round_number}
              </button>
            )
          );
        })}
        {Renderer ? (
          <Renderer contribution={c} />
        ) : (
          <Markdown text={c.summary} />
        )}
        {c.key_points.length > 0 && (
          <div className="response-points">
            <strong>{l("Key findings", "关键要点")}</strong>
            <Points items={c.key_points} />
          </div>
        )}
      </div>
      {c.stance_tags.length > 0 && (
        <ul className="stance-tags" aria-label={l("Stance tags", "立场标签")}>
          {c.stance_tags.map((tag, i) => (
            <li key={i}>
              <Hash size={12} aria-hidden="true" />
              {tag}
            </li>
          ))}
        </ul>
      )}
      <Fold
        summary={
          l("Read full text", "展开完整原文") +
          " (" +
          Array.from(c.full_content).length +
          ")"
        }
      >
        <Markdown text={c.full_content} />
      </Fold>
    </article>
  );
}

const roundLabels: Record<string, string> = {
  opening: "议题发布",
  critique: "交叉质询",
  rebuttal: "反驳",
  synthesis_request: "汇总请求",
};

export function Discussion({
  s,
  targets,
  jump,
  moderator,
}: {
  s: SubAgenda;
  targets: Map<string, Target>;
  jump: (target: Target) => void;
  moderator?: Topic["moderator"];
}) {
  const l = useL();
  const rounds = Array.from(
    new Set([...s.dispatches, ...s.contributions].map((r) => r.round_number)),
  ).sort((a, b) => a - b);
  return (
    <section className="discussion">
      <h2 className="discussion-title">{s.title}</h2>
      <Markdown text={s.prompt_framing} />
      {rounds.map((n) => (
        <section key={n}>
          <div className="round">
            <span>Round {n}</span>
            <hr />
          </div>
          {s.dispatches
            .filter((d) => d.round_number === n)
            .map((d) => {
              const sameChair =
                !d.moderator_name || d.moderator_name === moderator?.name;
              const name = d.moderator_name || moderator?.name;
              return (
                <article key={d.id} className="panel dispatch">
                  <div className="speech-identity">
                    <AgentAvatar
                      name={name || l("Moderator", "主持人")}
                      model={sameChair ? moderator?.model : undefined}
                      provider={sameChair ? moderator?.provider : undefined}
                      chair
                    />
                    <div className="speech-byline">
                      <div className="speech-author">
                        {name && <strong>{name}</strong>}
                        <span className="speech-role chair-role">
                          {l("Moderator", "主持人")}
                        </span>
                      </div>
                      <span className="speech-meta">
                        {l(
                          d.round_type.replaceAll("_", " "),
                          roundLabels[d.round_type] || "任务发布",
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="dispatch-copy">
                    <h3>{d.title}</h3>
                    <Markdown text={d.prompt_summary} />
                  </div>
                  <Fold summary={l("Show full prompt", "展开完整任务")}>
                    <Markdown text={d.prompt_full} />
                  </Fold>
                </article>
              );
            })}
          {s.contributions
            .filter((c) => c.round_number === n)
            .map((c) => (
              <ResponseCard key={c.id} c={c} targets={targets} jump={jump} />
            ))}
        </section>
      ))}
      {s.synthesis_summary && (
        <section className="panel lead">
          <h2>{l("Discussion synthesis", "子议程综述")}</h2>
          <Markdown text={s.synthesis_summary} />
        </section>
      )}
    </section>
  );
}
