import { useL } from "./context";
import { useRef, useState } from "react";
import { ChevronRight, Crown, UsersRound } from "lucide-react";
import { AgentAvatar } from "./AgentAvatar";
import { Modal } from "./ui";
import type { Topic } from "./types";

function Laurel() {
  return (
    <svg className="plaque-laurel" viewBox="0 0 56 20" aria-hidden="true">
      <g stroke="#866b35" strokeWidth="1.15" strokeLinejoin="round">
        <path d="M23 16C18 15 10 9 5 3m28 13C38 15 46 9 51 3" fill="none" />
        <path
          fill="#afc986"
          d="M10 8C5 10 2 7 1 5c4-1 7 0 9 3Zm5 4c-4 3-8 1-10-1 4-2 7-2 10 1Zm-3-2c-1-4 0-7 2-9 2 4 2 7-2 9Zm7 4c-1-4 0-7 3-9 1 4 0 7-3 9Z"
        />
        <path
          fill="#afc986"
          d="M46 8c5 2 8-1 9-3-4-1-7 0-9 3Zm-5 4c4 3 8 1 10-1-4-2-7-2-10 1Zm3-2c1-4 0-7-2-9-2 4-2 7 2 9Zm-7 4c1-4 0-7-3-9-1 4 0 7 3 9Z"
        />
        <path fill="#ffcc66" d="m28 5 4 6-4 6-4-6z" />
      </g>
    </svg>
  );
}

export function VenuePlaque({ topic }: { topic: Topic }) {
  const l = useL();
  const [showRoster, setShowRoster] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeRoster = () => {
    setShowRoster(false);
    requestAnimationFrame(() =>
      trigger.current?.focus({ preventScroll: true }),
    );
  };
  const people = topic.panelists.map((p) => ({
    ...p,
    chair: false,
  }));
  const moderator = topic.moderator;
  const members = [
    ...(moderator && (moderator.name || moderator.model || moderator.provider)
      ? [
          {
            ...moderator,
            name: moderator.name || moderator.model || moderator.provider,
            id: "",
            chair: true,
            role: "",
          },
        ]
      : []),
    ...people,
  ];
  const visible = members.slice(0, 4);
  return (
    <>
      <div className="venue-plaque">
        <Laurel />
        <h3 title={topic.title}>{topic.title}</h3>
        {members.length > 0 && (
          <button
            type="button"
            className="plaque-participants"
            ref={trigger}
            aria-label={`${l("Participants", "参会人员")} (${members.length})`}
            aria-haspopup="dialog"
            onClick={() => setShowRoster(true)}
          >
            {visible.map((p) => (
              <span
                key={p.chair ? "chair" : "expert-" + p.id}
                className="plaque-person"
                title={[
                  p.name,
                  p.role ||
                    (p.chair ? l("Chair", "主席") : l("Expert", "专家")),
                ].join(" · ")}
              >
                <AgentAvatar {...p} size={32} />
                <span
                  className={p.chair ? "plaque-badge is-chair" : "plaque-badge"}
                >
                  {p.chair ? l("Chair", "主席") : l("Expert", "专家")}
                </span>
              </span>
            ))}
            {members.length > visible.length ? (
              <span className="plaque-more">
                +{members.length - visible.length}
              </span>
            ) : (
              <ChevronRight size={14} aria-hidden="true" />
            )}
          </button>
        )}
      </div>
      {showRoster && (
        <Modal
          title={l("Participants", "参会人员")}
          icon={<UsersRound size={23} />}
          close={closeRoster}
        >
          <ul className="plaque-roster">
            {members.map((p) => (
              <li key={p.chair ? "chair" : "expert-" + p.id}>
                <AgentAvatar {...p} size={38} />
                <div>
                  <strong>{p.name}</strong>
                  <span
                    className={
                      p.chair ? "plaque-badge is-chair" : "plaque-badge"
                    }
                  >
                    {p.chair && <Crown size={11} />}
                    {p.chair ? l("Chair", "主席") : l("Expert", "专家")}
                  </span>
                  {p.role && <p>{p.role}</p>}
                  {(p.model || p.provider) && (
                    <small>
                      {[p.model, p.provider].filter(Boolean).join(" · ")}
                    </small>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </>
  );
}
