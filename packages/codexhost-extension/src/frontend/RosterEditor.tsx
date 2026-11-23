import { useState } from "react";
import {
  assignments,
  hostRoster,
  initialSeat,
  RosterFields,
} from "./AgentPicker";
import { useL, useWorkspace } from "./context";
import type { Topic } from "./types";
import { Modal } from "./ui";
export function RosterEditor({
  topic,
  close,
}: {
  topic: Topic;
  close: () => void;
}) {
  const l = useL(),
    { rpc, busy, perform } = useWorkspace(),
    host = hostRoster(topic);
  const [people, roster] = useState(() =>
    topic.panelists.map((p) => initialSeat(p, host.panelist_threads?.[p.id])),
  );
  const [chair, setChair] = useState(() =>
    host.moderator_config ||
    topic.moderator.provider ||
    topic.moderator.model ||
    topic.moderator.name
      ? initialSeat(
          { ...topic.moderator, ...host.moderator_display },
          host.moderator_config,
        )
      : null,
  );
  const locked = new Set(
    topic.agendas.flatMap((a) =>
      a.sub_agendas.flatMap((s) => [
        ...s.dispatches.flatMap((d) => d.target_panelist_ids),
        ...s.contributions.map((c) => c.panelist_id),
      ]),
    ),
  );
  async function save() {
    const {
      panelists,
      moderator,
      host: config,
    } = assignments(
      people,
      chair,
      topic.moderator.name || l("Moderator", "主持人"),
      topic,
    );
    await perform(async () => {
      await rpc.call("topics/update", {
        topicId: topic.id,
        patch: { panelists, moderator, metadata: { codexhost: config } },
      });
      close();
    });
  }
  return (
    <Modal
      title={l("Configure roles & agents", "配置专家与角色")}
      wide
      close={close}
    >
      <form
        className="council-wizard"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <RosterFields
          cwd={host.project_cwd || ""}
          {...{ people, roster, chair, setChair, locked }}
        />
        <footer className="form-footer">
          <button type="button" onClick={close}>
            {l("Cancel", "取消")}
          </button>
          <button className="primary" disabled={busy}>
            {l("Save roles", "保存角色配置")}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
