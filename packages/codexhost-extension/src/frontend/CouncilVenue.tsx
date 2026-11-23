import { useL, useAssets, useWorkspace } from "./context";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  DoorOpen,
  Landmark,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";
import { AgentAvatar } from "./AgentAvatar";
import { VenuePlaque } from "./VenuePlaque";
import type { Agenda, Contribution, Expert, SubAgenda, Topic } from "./types";
import { Markdown, Points, labels } from "./ui";
import { portraits, venueStyles, type VenueStyle } from "./venue/registry";
import { VenueTokenArt } from "./venue/VenueTokenArt";

type Props = {
  topic: Topic;
  agenda?: Agenda;
  sub?: SubAgenda;
  onEnter: (agendaId: string, subId: string) => void;
  onLobby: () => void;
};

function preference(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Selection still works for this view. */
  }
}
function pin(x: number, y: number): CSSProperties {
  return { left: x + "%", top: y + "%" };
}

function Pager({
  page,
  count,
  onPage,
  noun,
}: {
  page: number;
  count: number;
  onPage: (n: number) => void;
  noun: string;
}) {
  const l = useL();
  if (count <= 1) return null;
  return (
    <div className="venue-pager">
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={page === 0}
        aria-label={l(`Previous ${noun}`, `上一组${noun}`)}
      >
        <ChevronLeft size={17} />
      </button>
      <span aria-live="polite">
        {page + 1} / {count}
      </span>
      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={page + 1 === count}
        aria-label={l(`Next ${noun}`, `下一组${noun}`)}
      >
        <ChevronRight size={17} />
      </button>
    </div>
  );
}

function Lobby({
  topic,
  skin,
  onEnter,
}: Pick<Props, "topic" | "onEnter"> & { skin: VenueStyle }) {
  const l = useL();
  const rooms = topic.agendas.flatMap((agenda) =>
    agenda.sub_agendas.map((sub) => ({ agenda, sub })),
  );
  const [page, setPage] = useState(0);
  const capacity = skin.doorPositions.length;
  const pages = Math.ceil(rooms.length / capacity);
  const current = Math.max(0, Math.min(page, pages - 1));
  const Table = skin.Table,
    Door = skin.Door;
  return (
    <>
      <div
        className="venue-stage venue-map"
        aria-label={l("Discussion room entrances", "子议题会场入口")}
      >
        <div className="venue-plinth" aria-hidden="true">
          <Table />
        </div>
        <VenuePlaque topic={topic} />
        {rooms
          .slice(current * capacity, (current + 1) * capacity)
          .map(({ agenda, sub }, i) => {
            const [x, y] = skin.doorPositions[i];
            return (
              <button
                type="button"
                key={sub.id}
                className={"venue-hotspot venue-door " + sub.status}
                style={pin(x, y)}
                onClick={() => onEnter(agenda.id, sub.id)}
                title={`${agenda.title} / ${sub.title}`}
                aria-label={l(
                  `Enter ${sub.code} · ${sub.title}`,
                  `进入子议题 ${sub.code} · ${sub.title}`,
                )}
              >
                <VenueTokenArt>
                  <Door />
                </VenueTokenArt>
                <span className="venue-door-label">
                  <b>{sub.code || agenda.code || <DoorOpen size={12} />}</b>
                  <span>{sub.title}</span>
                  <ChevronRight size={13} />
                </span>
                <span className="venue-door-status">
                  <i />
                  {l(
                    sub.status.replaceAll("_", " "),
                    labels[sub.status] ?? sub.status,
                  )}
                </span>
              </button>
            );
          })}
      </div>
      <div className="venue-ribbon">
        <span>
          <DoorOpen size={16} />
          {rooms.length
            ? l(
                `${rooms.length} rooms · Choose a door to enter`,
                `${rooms.length} 个子议题 · 选择会场门进入讨论`,
              )
            : l(
                "Waiting for the first discussion room",
                "等待主持人发布子议题",
              )}
        </span>
        <Pager
          page={current}
          count={pages}
          noun={l("room", "会场门")}
          onPage={setPage}
        />
      </div>
    </>
  );
}

function Manual({ agenda, sub }: { agenda: Agenda; sub: SubAgenda }) {
  const l = useL();
  return (
    <div className="venue-book-pages">
      <h3>
        <BookOpen size={21} />
        {l("Council minutes", "会议手册")}{" "}
        <span>
          {sub.code} · {sub.title}
        </span>
      </h3>
      {sub.synthesis_summary && (
        <section>
          <h4>{l("Discussion synthesis", "子议题综述")}</h4>
          <Markdown text={sub.synthesis_summary} />
        </section>
      )}
      {sub.contributions.length > 0 && (
        <section>
          <h4>
            {l("Contributions ·", "已收录发言 ·")} {sub.contributions.length}
          </h4>
          {sub.contributions.map((c) => (
            <article key={c.id} className="venue-minute">
              <strong>
                {c.panelist_name || c.panelist_id}
                <small>
                  {l("Round ", "第 ")}
                  {c.round_number}
                  {l("", " 轮")}
                </small>
              </strong>
              <Markdown text={c.summary} />
              <Points items={c.key_points} />
            </article>
          ))}
        </section>
      )}
      {(agenda.conclusion_summary ||
        agenda.conclusion_key_points.length > 0) && (
        <section>
          <h4>{l("Agenda conclusions", "所属议程结论")}</h4>
          <Markdown text={agenda.conclusion_summary} />
          <Points items={agenda.conclusion_key_points} />
        </section>
      )}
      {!sub.synthesis_summary && !sub.contributions.length && (
        <p>{l("No contributions yet.", "这个子议题还没有收录发言。")}</p>
      )}
    </div>
  );
}

function roster(topic: Topic, sub: SubAgenda) {
  const people = new Map<
    string,
    Pick<Expert, "id" | "name" | "model" | "provider" | "role">
  >(topic.panelists.map((p) => [p.id, p]));
  for (const c of sub.contributions) {
    if (!people.has(c.panelist_id))
      people.set(c.panelist_id, {
        id: c.panelist_id,
        name: c.panelist_name || c.panelist_id,
        model: c.model,
        provider: "",
        role: c.role,
      });
  }
  return [...people.values()];
}

function latestContribution(sub: SubAgenda, expertId: string) {
  let latest: Contribution | undefined;
  for (const c of sub.contributions) {
    if (c.panelist_id !== expertId) continue;
    const time = Date.parse(c.created_at ?? ""),
      previous = Date.parse(latest?.created_at ?? "");
    if (
      !Number.isFinite(time) ||
      !Number.isFinite(previous) ||
      time >= previous
    )
      latest = c;
  }
  return latest;
}

function CircleRoom({
  topic,
  agenda,
  sub,
  skin,
  onLobby,
}: {
  topic: Topic;
  agenda: Agenda;
  sub: SubAgenda;
  skin: VenueStyle;
  onLobby: () => void;
}) {
  const l = useL();
  const [personId, setPerson] = useState("");
  const [openBook, setBook] = useState(false);
  const [page, setPage] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const assets = useAssets();
  const people = roster(topic, sub);
  const waiting = new Set(
    useWorkspace()
      .runs.filter(
        (r) =>
          r.subAgendaId === sub.id && ["running", "queued"].includes(r.status),
      )
      .map((r) => r.panelistId),
  );
  const seatsPerPage = 6,
    pages = Math.ceil(people.length / seatsPerPage);
  const current = Math.max(0, Math.min(page, pages - 1));
  const seats = people.slice(
    current * seatsPerPage,
    (current + 1) * seatsPerPage,
  );
  const selected = people.find((p) => p.id === personId);
  const last = selected && latestContribution(sub, selected.id);
  const prefix = "althing.venue.portrait." + topic.id + ":";
  const portrait = (id: string) => {
    const chosen = overrides[id] ?? preference(prefix + id);
    return (
      portraits.find((p) => p.id === chosen) ??
      portraits[people.findIndex((p) => p.id === id) % portraits.length]
    );
  };
  const bubbleId = useId(),
    bookId = useId();
  const bookRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (openBook) bookRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [openBook]);
  const { Table, Door } = skin;
  return (
    <>
      <div
        className="venue-stage venue-circle"
        aria-label={l("Expert roundtable", "专家圆桌")}
      >
        <button
          type="button"
          className="venue-return-portal venue-hotspot"
          onClick={onLobby}
        >
          <VenueTokenArt>
            <Door />
          </VenueTokenArt>
          <span className="venue-return-sign">
            <ArrowLeft size={13} aria-hidden="true" />
            {l("Return to the hall", "返回主会场")}
          </span>
        </button>
        <div className="venue-round-table" aria-hidden="true">
          <Table />
        </div>
        {seats.map((p, i) => {
          const angle =
            (i / seats.length) * 2 * Math.PI +
            (seats.length === 2
              ? Math.PI / 2
              : seats.length % 2 === 0
                ? Math.PI / seats.length
                : 0);
          const x = 50 + 27 * Math.sin(angle),
            y = 51 - 24 * Math.cos(angle);
          return (
            <button
              type="button"
              key={p.id}
              className={
                "venue-hotspot venue-seat" +
                (waiting.has(p.id) ? " thinking" : "")
              }
              style={{ ...pin(x, y), zIndex: Math.round(y) }}
              aria-label={l(
                `View contributions from ${p.name}`,
                `查看 ${p.name} 的发言`,
              )}
              aria-expanded={personId === p.id}
              aria-controls={bubbleId}
              onClick={() => {
                setPerson(personId === p.id ? "" : p.id);
                setBook(false);
              }}
            >
              <VenueTokenArt>
                <span className="venue-figure">
                  <img src={assets[portrait(p.id).image]} alt="" />
                  <span className="venue-identity">
                    <AgentAvatar {...p} size={23} />
                  </span>
                  {waiting.has(p.id) && (
                    <span className="venue-thought" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                </span>
              </VenueTokenArt>
              <strong title={p.name}>{p.name}</strong>
              {waiting.has(p.id) && <small>{l("Thinking", "待回复")}</small>}
            </button>
          );
        })}
        <button
          type="button"
          className="venue-hotspot venue-handbook"
          aria-expanded={openBook}
          aria-controls={bookId}
          onClick={() => {
            setBook(!openBook);
            setPerson("");
          }}
        >
          <VenueTokenArt>
            <span className="venue-bound-book" aria-hidden="true">
              <span>
                <Sparkles size={14} />
              </span>
            </span>
          </VenueTokenArt>
          <b>{l("Council minutes", "会议手册")}</b>
        </button>
      </div>
      <div className="venue-ribbon">
        <span>
          <UsersRound size={16} />
          {people.length
            ? l(
                `${people.length} experts · Select a seat to read contributions`,
                `${people.length} 位专家 · 点选头像查看发言`,
              )
            : l("Waiting for panelists", "等待专家入席")}
        </span>
        <Pager
          page={current}
          count={pages}
          noun={l("Expert", "专家")}
          onPage={(n) => {
            setPage(n);
            setPerson("");
          }}
        />
      </div>
      <div id={bubbleId} hidden={!selected}>
        {selected && (
          <div className="venue-bubble">
            <img
              className="venue-speaker-portrait"
              src={assets[portrait(selected.id).image]}
              alt=""
            />
            <div className="venue-speech">
              <div className="venue-speech-head">
                <AgentAvatar {...selected} size={22} />
                <strong>{selected.name}</strong>
                {last && (
                  <small>
                    {l(
                      `Round ${last.round_number} · Latest`,
                      `第 ${last.round_number} 轮 · 上次发言`,
                    )}
                  </small>
                )}
              </div>
              {selected.role && (
                <p className="venue-speaker-role">{selected.role}</p>
              )}
              <div className="venue-speech-text">
                {last ? (
                  <Markdown text={last.summary} />
                ) : (
                  <p>
                    {l(
                      "This expert has yet to contribute.",
                      "该专家在这个子议题暂无发言。",
                    )}
                  </p>
                )}
              </div>
              {waiting.has(selected.id) && (
                <p className="venue-pending">
                  {l(
                    "Awaiting this expert’s reply.",
                    "主持人已派单，等待回复。",
                  )}
                </p>
              )}
              <label className="venue-avatar-picker">
                {l("Portrait", "角色形象")}
                <select
                  value={portrait(selected.id).id}
                  onChange={(e) => {
                    remember(prefix + selected.id, e.target.value);
                    setOverrides({
                      ...overrides,
                      [selected.id]: e.target.value,
                    });
                  }}
                >
                  {portraits.map((p) => (
                    <option value={p.id} key={p.id}>
                      {l(p.id, p.name)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              className="venue-dismiss"
              aria-label={l("Close contribution", "收起发言气泡")}
              onClick={() => setPerson("")}
            >
              <X size={17} />
            </button>
          </div>
        )}
      </div>
      <div id={bookId} ref={bookRef} hidden={!openBook}>
        {openBook && <Manual agenda={agenda} sub={sub} />}
      </div>
    </>
  );
}

export default function CouncilVenue({
  topic,
  agenda,
  sub,
  onEnter,
  onLobby,
}: Props) {
  const l = useL();
  const assets = useAssets();
  const [styleId, setStyle] = useState(() => preference("althing.venue.style"));
  const skin = venueStyles.find((s) => s.id === styleId) ?? venueStyles[0];
  const room = agenda && sub;
  const venue = useRef<HTMLElement>(null);
  const returnToHall = () => {
    onLobby();
    requestAnimationFrame(() => venue.current?.focus({ preventScroll: true }));
  };
  return (
    <section
      ref={venue}
      tabIndex={-1}
      className="council-venue"
      aria-label={
        room
          ? l("Discussion room", "子议题会场")
          : l("Council venue", "议事厅会场")
      }
      style={
        {
          "--venue-backdrop": `url("${assets[skin.backdrop] || ""}")`,
          "--venue-sky": skin.sky,
          "--venue-accent": skin.accent,
        } as CSSProperties
      }
    >
      <div className="venue-controls">
        <div className="venue-breadcrumb">
          {room ? (
            <>
              <button type="button" onClick={returnToHall}>
                <ArrowLeft size={16} />
                {l("Council hall", "会场大厅")}
              </button>
              <ChevronRight size={14} />
              <h2>
                {sub.code} · {sub.title}
              </h2>
            </>
          ) : (
            <h2>
              <Landmark size={21} />
              {l("Council hall", "会场大厅")}
            </h2>
          )}
        </div>
        <label className="venue-picker">
          <Sparkles size={15} />
          <select
            aria-label={l("Venue style", "会场风格")}
            value={skin.id}
            onChange={(e) => {
              remember("althing.venue.style", e.target.value);
              setStyle(e.target.value);
            }}
          >
            {venueStyles.map((s) => (
              <option key={s.id} value={s.id}>
                {l(
                  s.id === "olympus" ? "Olympian hall" : "Starlit garden",
                  s.name,
                )}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </label>
      </div>
      {room ? (
        <CircleRoom
          key={sub.id}
          topic={topic}
          agenda={agenda}
          sub={sub}
          skin={skin}
          onLobby={returnToHall}
        />
      ) : (
        <Lobby key={topic.id} topic={topic} skin={skin} onEnter={onEnter} />
      )}
    </section>
  );
}
