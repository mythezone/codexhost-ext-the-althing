import {
  fields,
  models,
  now,
  reportHead,
  type Kind,
  type Topic,
  type Agenda,
  type SubAgenda,
  type Dispatch,
  type Contribution,
  type Report,
  type Archive,
  type Card,
} from "./models.ts";
import { protocols } from "./protocols.ts";
import { renderReport } from "./rendering.ts";

type Pins = {
  _progress: number | null;
  _activity: string | null;
  _status: boolean;
};
export type StoredSub = Omit<SubAgenda, "dispatches"> &
  Pins & { dispatches: Omit<Dispatch, "contributions">[] };
type StoredAgenda = Omit<Agenda, "sub_agendas"> &
  Pins & { sub_agendas: StoredSub[] };
export type StoredTopic = Omit<
  Topic,
  "agendas" | keyof import("./models.ts").Counts
> &
  Pins & { agendas: StoredAgenda[] };
type Rows = {
  topic: StoredTopic;
  agenda: StoredAgenda;
  sub_agenda: StoredSub;
  dispatch: Omit<Dispatch, "contributions">;
  contribution: Contribution;
  report: Report;
};
type Row = Rows[Kind];
type ProgressRow = StoredTopic | StoredAgenda | StoredSub;
type Input = Record<string, unknown>;
export const input = (v: unknown): Input => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("Expected an object");
  return v as Input;
};
export const active = (status: string) =>
  ["dispatching", "in_progress", "critiquing"].includes(status);
export function meanPercent(sum: number, n: number) {
  const floor = Math.floor(sum / n);
  return (sum % n) * 2 === n ? floor + (floor % 2) : Math.round(sum / n);
}
function settle(row: ProgressRow) {
  row.completed_at = ["completed", "archived"].includes(row.status)
    ? row.completed_at || now()
    : null;
}
function progress(row: ProgressRow, supplied: Input, kind: Kind) {
  if (kind !== "sub_agenda") {
    if ("progress_pct" in supplied)
      row._progress = supplied.progress_pct as number | null;
    if ("current_activity" in supplied)
      row._activity = row.current_activity || null;
    if (kind === "agenda" && "status" in supplied)
      row._status = row.status !== "pending";
    row.progress_pct = row._progress ?? row.progress_pct;
  }
  if (
    row.progress_pct == null ||
    ("status" in supplied &&
      !("progress_pct" in supplied) &&
      row._progress == null)
  ) {
    if (["completed", "archived"].includes(row.status)) row.progress_pct = 100;
    else if (
      ["pending", "draft"].includes(row.status) ||
      row.progress_pct == null
    )
      row.progress_pct = 0;
  }
  row.current_activity ||= "";
  settle(row);
}
function publicProgress<T extends ProgressRow>(row: T) {
  const { _progress, _activity, _status, ...rest } = row;
  return {
    ...rest,
    ...("synthesis_summary" in row
      ? {}
      : {
          pinned_fields: [
            ...(_progress === null ? [] : ["progress_pct"]),
            ...(_activity ? ["current_activity"] : []),
            ...(_status ? ["status"] : []),
          ],
        }),
  };
}
export function validateDependencies(t: StoredTopic) {
  const subs = t.agendas.flatMap((a) => a.sub_agendas);
  const degrees = new Map(subs.map((s) => [s.id, new Set(s.depends_on).size]));
  const dependents = new Map<string, string[]>();
  for (const s of subs)
    for (const dep of new Set(s.depends_on)) {
      if (!degrees.has(dep))
        throw Error("Dependencies must belong to the topic");
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(s.id);
    }
  const ready = subs.filter((s) => !degrees.get(s.id)).map((s) => s.id);
  for (let i = 0; i < ready.length; i++)
    for (const next of dependents.get(ready[i]) ?? []) {
      const n = degrees.get(next)! - 1;
      degrees.set(next, n);
      if (!n) ready.push(next);
    }
  if (ready.length !== subs.length)
    throw Error("Sub-agenda dependencies contain a cycle");
}
export class Council {
  reportLocale = "en";
  tree!: StoredTopic;
  readonly events: { type: string; resource_id: string }[] = [];
  readonly insertedIds: string[] = [];
  private readonly rows = new Map<string, { kind: Kind; row: Row }>();
  constructor(tree?: StoredTopic) {
    if (!tree) return;
    this.tree = tree;
    this.index("topic", tree);
    for (const a of tree.agendas) {
      this.index("agenda", a);
      for (const s of a.sub_agendas) {
        this.index("sub_agenda", s);
        for (const d of s.dispatches) this.index("dispatch", d);
        for (const c of s.contributions) this.index("contribution", c);
      }
    }
    for (const r of tree.reports) this.index("report", r);
  }
  private index<K extends Kind>(kind: K, row: Rows[K]) {
    if (this.rows.has(row.id)) throw Error("Resource ID already exists");
    this.rows.set(row.id, { kind, row });
  }
  get<K extends Kind>(kind: K, id: unknown): Rows[K] {
    const found = typeof id === "string" && this.rows.get(id);
    if (!found || found.kind !== kind)
      throw Error("Unknown " + kind + " in this topic");
    return found.row as Rows[K];
  }
  emit(type: string, resource_id: string) {
    this.events.push({ type, resource_id });
  }
  references<K extends Kind>(kind: K, row: Rows[K]) {
    if (
      kind === "topic" &&
      !protocols.some((p) => p.id === this.tree.protocol_id)
    )
      throw Error("Unknown discussion protocol");
    if (kind === "topic" || kind === "agenda") {
      const rid =
        "final_report_id" in row
          ? row.final_report_id
          : (row as StoredAgenda).report_id;
      if (
        rid &&
        this.get("report", rid).agenda_id !== (kind === "topic" ? null : row.id)
      )
        throw Error("Report belongs to a different council or agenda");
    }
    if (kind === "report" && (row as Report).agenda_id)
      this.get("agenda", (row as Report).agenda_id);
    if (
      "target_panelist_ids" in row &&
      row.target_panelist_ids.some(
        (id) => !this.tree.panelists.some((p) => p.id === id),
      )
    )
      throw Error("Unknown target panelist");
    if ("panelist_id" in row) {
      const panel = this.tree.panelists,
        p = panel.find((p) => p.id === row.panelist_id);
      if (panel.length && !p) throw Error("Unknown panelist");
      if (p) {
        row.panelist_name ||= p.name;
        for (const key of [
          "model",
          "provider",
          "subscription",
          "reasoning_effort",
          "role",
        ] as const)
          row[key] ||= p[key];
      }
      for (const id of row.target_contribution_ids) {
        if (id === row.id) throw Error("Invalid self response target");
        this.get("contribution", id);
      }
      if (row.dispatch_id) {
        const d = this.get("dispatch", row.dispatch_id);
        if (
          d.sub_agenda_id !== row.sub_agenda_id ||
          d.round_number !== row.round_number
        )
          throw Error("Dispatch does not match sub-agenda and round");
      }
    }
  }
  create<K extends Kind>(
    kind: K,
    value: unknown,
    parentId?: string,
    finish = true,
  ): Rows[K] {
    const raw = input(value),
      parsed = models[kind].parse(raw),
      stamp = now();
    // Fields common to stored rows are added after validating only the author's input.
    const row = {
      ...parsed,
      created_at: stamp,
      updated_at: stamp,
    } as unknown as Rows[K];
    if (kind === "topic") {
      if (this.tree) throw Error("Topic already exists");
      this.tree = Object.assign(row as StoredTopic, {
        agendas: [],
        reports: [],
        archives: [],
      });
    } else {
      Object.assign(row, { topic_id: this.tree.id });
      if (kind === "agenda" || kind === "report") this.get("topic", parentId);
      if (kind === "agenda" || kind === "sub_agenda") {
        const ordered = row as StoredAgenda | StoredSub;
        const parent =
          kind === "agenda" ? this.tree : this.get("agenda", parentId);
        const siblings =
          "agendas" in parent ? parent.agendas : parent.sub_agendas;
        ordered.order_index ??=
          siblings.reduce(
            (max, s) => Math.max(max, s.order_index ?? 0),
            siblings.length ? -Infinity : 0,
          ) + 1;
        ordered.code ||=
          ("code" in parent ? parent.code + "." : "A") + ordered.order_index;
        if (kind === "agenda")
          this.tree.agendas.push(
            Object.assign(ordered, { sub_agendas: [] }) as StoredAgenda,
          );
        else
          (parent as StoredAgenda).sub_agendas.push(
            Object.assign(ordered, {
              agenda_id: parent.id,
              contributions: [],
              dispatches: [],
            }) as StoredSub,
          );
      } else if (kind === "dispatch" || kind === "contribution") {
        const s = this.get("sub_agenda", parentId);
        Object.assign(row, { agenda_id: s.agenda_id, sub_agenda_id: s.id });
        if (kind === "dispatch") s.dispatches.push(row as Rows["dispatch"]);
        else s.contributions.push(row as Contribution);
      }
    }
    if (["topic", "agenda", "sub_agenda"].includes(kind)) {
      Object.assign(row, { _progress: null, _activity: null, _status: false });
      progress(row as ProgressRow, raw, kind);
    }
    this.index(kind, row);
    this.insertedIds.push(row.id);
    this.references(kind, row);
    if (kind === "report") {
      const r = row as Report & { set_as_primary?: boolean };
      r.report_type ??= r.agenda_id ? "agenda" : "final";
      r.format = r.html_content ? "html" : "markdown";
      if (r.html_content) r.source_html = r.html_content;
      r.html_content = renderReport(r, this.tree.title,this.reportLocale);
      if (r.set_as_primary && r.report_type !== "custom") {
        const owner = r.agenda_id ? this.get("agenda", r.agenda_id) : this.tree;
        if ("report_id" in owner) owner.report_id = r.id;
        else owner.final_report_id = r.id;
        owner.updated_at = stamp;
      }
      delete r.set_as_primary;
      this.tree.reports.push(r);
    }
    this.emit(
      kind +
        "." +
        (kind === "report"
          ? "published"
          : ["dispatch", "contribution"].includes(kind)
            ? "created"
            : "updated"),
      row.id,
    );
    // Keep the original field presence for nested pins and generated IDs.
    if (kind === "topic")
      for (const a of (raw.agendas ?? []) as Input[])
        this.create("agenda", a, row.id, false);
    if (kind === "agenda")
      for (const s of (raw.sub_agendas ?? []) as Input[])
        this.create("sub_agenda", s, row.id, false);
    if (finish) {
      validateDependencies(this.tree);
      this.rollup();
    }
    return row;
  }
  patch<K extends Kind>(kind: K, key: string, value: unknown): Rows[K] {
    const row = this.get(kind, key),
      patch = { ...input(value) },
      shape = fields[kind];
    for (const field of Object.keys(patch)) {
      if (
        !Object.hasOwn(shape, field) ||
        ["id", "agendas", "sub_agendas"].includes(field) ||
        (kind === "contribution" &&
          !["summary", "key_points", "stance_tags"].includes(field))
      )
        throw Error("Unsupported patch field: " + field);
    }
    if (["topic", "agenda"].includes(kind) && patch.progress_pct === "")
      patch.progress_pct = null;
    if (
      kind === "agenda" &&
      "status" in patch &&
      (patch.status == null || patch.status === "")
    )
      patch.status = "pending";
    const base = Object.fromEntries(
      Object.keys(shape)
        .filter(
          (k) =>
            k !== "agendas" && k !== "sub_agendas" && Object.hasOwn(row, k),
        )
        .map((k) => [k, Reflect.get(row, k)]),
    );
    const validated = models[kind].parse({ ...base, ...patch });
    for (const k of Object.keys(patch))
      Reflect.set(row, k, Reflect.get(validated, k));
    this.references(kind, row);
    if (kind === "topic" && "panelists" in patch) {
      const ids = new Set(this.tree.panelists.map((p) => p.id));
      for (const { row: r } of this.rows.values()) {
        if (
          ("target_panelist_ids" in r &&
            r.target_panelist_ids.some((id) => !ids.has(id))) ||
          ("panelist_id" in r && !ids.has(r.panelist_id))
        )
          throw Error(
            "Keep panelists referenced by previously published discussion",
          );
      }
    }
    if ("_progress" in row) progress(row, patch, kind);
    if ("depends_on" in patch) validateDependencies(this.tree);
    row.updated_at = now();
    this.rollup();
    this.emit(kind + ".updated", key);
    return row;
  }
  rollup() {
    const t = this.tree,
      activities: string[] = [];
    for (const a of t.agendas) {
      const before = [
        a.progress_pct,
        a.current_activity,
        a.status,
        a.completed_at,
      ];
      const children = a.sub_agendas,
        activity = children
          .filter((s) => active(s.status))
          .map((s) => s.current_activity || s.title);
      if (children.length) {
        if (a._progress === null)
          a.progress_pct = meanPercent(
            children.reduce((sum, s) => sum + s.progress_pct, 0),
            children.length,
          );
        if (!a._status)
          a.status = children.every((s) => s.status === "completed")
            ? "completed"
            : children.some((s) => s.status !== "pending")
              ? "in_progress"
              : "pending";
      }
      a.current_activity = a._activity || activity.join(" · ");
      settle(a);
      if (active(a.status) || activity.length)
        activities.push(
          a.title + (a.current_activity ? " / " + a.current_activity : ""),
        );
      if (
        before.some(
          (v, i) =>
            v !==
            [a.progress_pct, a.current_activity, a.status, a.completed_at][i],
        )
      ) {
        a.updated_at = now();
        this.emit("agenda.updated", a.id);
      }
    }
    const prev = t.progress_pct,
      activity = t.current_activity;
    if (t._progress === null && t.agendas.length)
      t.progress_pct = meanPercent(
        t.agendas.reduce((n, a) => n + a.progress_pct, 0),
        t.agendas.length,
      );
    t.current_activity = t._activity || activities.join(" · ");
    t.updated_at = now();
    if (t.progress_pct !== prev || activity !== t.current_activity)
      this.emit("topic.updated", t.id);
  }
}
function counts(t: StoredTopic) {
  const subs = t.agendas.flatMap((a) => a.sub_agendas);
  return {
    agenda_count: t.agendas.length,
    completed_agendas: t.agendas.filter((a) => a.status === "completed").length,
    sub_agenda_count: subs.length,
    completed_sub_agendas: subs.filter((s) => s.status === "completed").length,
    contribution_count: subs.reduce((n, s) => n + s.contributions.length, 0),
    report_count: t.reports.length,
    archive_count: t.archives.length,
    active_agendas: t.agendas
      .filter((a) => active(a.status))
      .map((a) => a.title),
  };
}
const ordered = <T extends { order_index: number | null }>(rows: T[]) =>
  [...rows].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
// Match the reader’s character count without allocating an array of every code point.
function characters(text: string) {
  let count = text.length;
  const pairs = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
  while (pairs.test(text)) count--;
  return count;
}
export function hydrate(t: StoredTopic, reportContent = false): Topic {
  return {
    ...publicProgress(t),
    ...counts(t),
    reports: reportContent ? t.reports : t.reports.map(reportHead),
    agendas: ordered(t.agendas).map((a) => ({
      ...publicProgress(a),
      sub_agendas: ordered(a.sub_agendas).map((s) => {
        const replies = Map.groupBy(s.contributions, (c) => c.dispatch_id);
        return {
          ...publicProgress(s),
          dispatches: s.dispatches.map((d) => ({
            ...d,
            contributions: replies.get(d.id) ?? [],
          })),
        };
      }),
    })),
  };
}
export function topicSummary(t: StoredTopic) {
  const full = hydrate(t);
  return {
    ...full,
    agendas: full.agendas.map((a) => ({
      ...a,
      sub_agendas: a.sub_agendas.map((s) => ({
        ...s,
        contributions: s.contributions.map((c) => ({
          ...c,
          full_content: "",
          full_content_length: characters(c.full_content),
        })),
        dispatches: s.dispatches.map(({ contributions, ...d }) => ({
          ...d,
          prompt_full: "",
          prompt_full_length: characters(d.prompt_full),
          contribution_ids: contributions.map((c) => c.id),
        })),
      })),
    })),
  };
}
export function toCard(t: StoredTopic): Card {
  const host = input(t.metadata.codexhost ?? {});
  const {
    id,
    title,
    subtitle,
    status,
    protocol_id,
    progress_pct,
    domain_tags,
    updated_at,
    created_at,
    panelists,
    final_report_id,
  } = t;
  return {
    id,
    title,
    subtitle,
    status,
    protocol_id,
    progress_pct,
    domain_tags,
    updated_at,
    created_at,
    panelists,
    final_report_id,
    ...counts(t),
    description: t.description.slice(0, 2048),
    current_activity: t.current_activity.slice(0, 512),
    projectCwd: String(host.project_cwd ?? ""),
    projectLabel: String(host.project_label ?? ""),
    latest_archive: t.archives.at(-1) ?? null,
    activeRunCount: Array.isArray(host.runs)
      ? host.runs.filter(
          (r) => r?.status === "queued" || r?.status === "running",
        ).length
      : 0,
  };
}
