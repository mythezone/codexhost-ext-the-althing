import path from "node:path";
import { z } from "zod";
import {
  CodexHostBridge,
  HostError,
  modelRef,
  type Model,
  type ThreadSnapshot,
} from "./codexhost-bridge.ts";
import { Store } from "./storage.ts";
import {
  Council,
  hydrate,
  input,
  validateDependencies,
  meanPercent,
  type StoredTopic,
} from "./domain/council.ts";
import {
  uid,
  now,
  id,
  roundType,
  contributionKind,
  type Json,
} from "./domain/models.ts";
import { roundPrompt, moderatorPrompt } from "./domain/protocols.ts";

const config = z.object({
  harnessId: z.string().min(1).default("codex"),
  model: z.union([modelRef, z.string()]).nullable().default(null),
  thinking: z.string().default(""),
  threadId: z.string().nullable().default(null),
});
type Config = z.infer<typeof config>;
export type RunKind =
  | "panelist"
  | "synthesis"
  | "agenda_conclusion"
  | "report"
  | "plan";
export type Run = {
  id: string;
  kind: RunKind;
  topicId: string;
  agendaId?: string;
  subAgendaId?: string;
  dispatchId?: string;
  panelistId?: string;
  threadId: string | null;
  harnessId: string;
  model: Model | null;
  thinking: string;
  roundNumber?: number;
  roundType?: z.infer<typeof roundType>;
  contributionKind?: z.infer<typeof contributionKind>;
  targetContributionIds?: string[];
  status: "queued" | "running" | "completed" | "cancelled" | "failed";
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  progressText?: string;
  contributionId?: string;
  reportId?: string;
  error?: string;
  retryOf?: string;
  turnId?: string;
  previousTurnId?: string;
  continuing?: boolean;
  cancelRequested?: boolean;
  publishReport?: boolean;
  completeTopic?: boolean;
  task?: string;
  refs?: string[];
};
type State = {
  project_cwd: string;
  project_label: string;
  panelist_threads: Record<string, Config>;
  moderator_config?: Config;
  runs: Run[];
};
function state(t: StoredTopic): State {
  const raw = input(t.metadata.codexhost ?? {});
  const s = {
    ...raw,
    project_cwd: String(raw.project_cwd ?? ""),
    project_label: String(raw.project_label ?? ""),
    panelist_threads: Object.assign(
      Object.create(null),
      raw.panelist_threads ?? {},
    ),
    runs: raw.runs ?? [],
  } as State;
  t.metadata.codexhost = s as unknown as Json;
  return s;
}
const live = (r: Run) => r.status === "queued" || r.status === "running";
const completedStatus = (s: string) => s === "completed" || s === "idle";
const interrupted = (s: string) =>
  ["cancelled", "canceled", "interrupted"].includes(s);
const update = (c: Council, r: Run, fields: Partial<Run>) => {
  Object.assign(r, fields, { updatedAt: now() });
  c.emit("run.updated", r.id);
};
function extract(text: string) {
  if (/^\s*(?:\{|```json)/i.test(text)) {
    try {
      const parsed = z
        .object({
          summary: z.string().trim().min(1),
          key_points: z.array(z.string()).max(5),
          stance_tags: z.array(z.string()).default([]),
        })
        .safeParse(structured(text));
      if (parsed.success) return parsed.data;
    } catch {
      /* A Markdown answer may also begin with a code example. */
    }
  }
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const points = lines
    .filter((s) => /^(?:[-*+]|\d+[.)])\s+/.test(s))
    .map((s) => s.replace(/^(?:[-*+]|\d+[.)])\s+/, ""))
    .slice(0, 5);
  const lead =
    lines.find((s) => !/^#{1,6} |^[-*+] |^stance tags:/i.test(s)) ?? lines[0];
  if (!points.length) {
    const prose = lines.filter(
      (line) => line !== lead && !/^#|^stance tags:/i.test(line),
    );
    points.push(...prose.slice(0, 5));
  }
  const tags =
    lines
      .find((s) => /^stance tags:/i.test(s))
      ?.replace(/^stance tags:/i, "")
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  return { summary: lead.slice(0, 800), key_points: points, stance_tags: tags };
}
function structured(text: string) {
  return input(
    JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "")),
  );
}
const points = z.array(z.string());
function progress(c: Council, subId: string) {
  const runs = state(c.tree).runs.filter(
    (r) => r.subAgendaId === subId && r.kind === "panelist",
  );
  const slots = new Set(runs.map((r) => r.dispatchId + "/" + r.panelistId));
  const done = new Set(
    runs
      .filter((r) => r.status === "completed")
      .map((r) => r.dispatchId + "/" + r.panelistId),
  );
  const s = c.get("sub_agenda", subId);
  if (s.status !== "completed")
    c.patch("sub_agenda", s.id, {
      progress_pct: meanPercent(done.size * 100, slots.size + 1),
      current_activity: done.size + " / " + slots.size + " panelist responses",
    });
}
function makeRun(tid: string, kind: RunKind, cfg: Config): Run {
  const stamp = now();
  return {
    id: uid(),
    topicId: tid,
    kind,
    harnessId: cfg.harnessId,
    model: cfg.model,
    thinking: cfg.thinking,
    threadId: null,
    status: "queued",
    startedAt: stamp,
    updatedAt: stamp,
  };
}
export class Orchestrator {
  private activeTopics = new Set<string>();
  private inFlight = new Map<string, Promise<void>>();
  private timer?: NodeJS.Timeout;
  private cycle?: Promise<void>;
  private disposed = false;
  constructor(
    private store: Store,
    private bridge: CodexHostBridge,
    private interval = 2500,
  ) {}
  async resume() {
    for (const card of await this.store.list())
      if (card.activeRunCount) this.activeTopics.add(card.id);
    this.wake();
  }
  private wake(tid?: string) {
    if (this.disposed) return;
    if (tid) this.activeTopics.add(tid);
    if (!this.activeTopics.size) return;
    this.timer ??= setInterval(() => this.tick(), this.interval).unref();
    this.tick();
  }
  private tick() {
    if (this.disposed || this.cycle) return;
    this.cycle = this.scan()
      .catch(() => {
        /* Retry store access on the next tick. */
      })
      .finally(() => {
        this.cycle = undefined;
      });
  }
  private async scan() {
    for (const tid of this.activeTopics) {
      const c = await this.store.serial(
        async () => new Council(await this.store.load(tid)),
      );
      const runs = state(c.tree).runs.filter(live);
      if (!runs.length) {
        this.activeTopics.delete(tid);
        continue;
      }
      for (const r of runs) {
        if (this.disposed || this.inFlight.has(r.id)) continue;
        const sequential =
          r.subAgendaId &&
          c.get("sub_agenda", r.subAgendaId).execution_mode === "sequential";
        if (
          r.status === "queued" &&
          sequential &&
          runs.find((other) => other.subAgendaId === r.subAgendaId)?.id !== r.id
        )
          continue;
        if (
          r.status === "queued" &&
          r.panelistId &&
          runs.find((other) => other.panelistId === r.panelistId)?.id !== r.id
        )
          continue;
        const job = this.advance(tid, r.id)
          .catch(() => {
            /* A disk failure leaves the durable run available for recovery. */
          })
          .finally(() => this.inFlight.delete(r.id));
        this.inFlight.set(r.id, job);
      }
    }
    if (!this.activeTopics.size) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
  private edit<T>(
    tid: string,
    rid: string,
    fn: (c: Council, r: Run, s: State) => T,
  ) {
    return this.store.transaction(tid, (c) => {
      const s = state(c.tree),
        r = s.runs.find((r) => r.id === rid);
      if (!r) throw Error("Unknown run");
      return fn(c, r, s);
    });
  }
  async dispatchRound(
    tid: string,
    subId: string,
    params: Record<string, unknown>,
  ) {
    const result = await this.store.transaction(tid, (c) => {
      const sub = c.get("sub_agenda", subId),
        t = c.tree,
        s = state(t);
      if (t.status === "archived" || !path.isAbsolute(s.project_cwd))
        throw Error("Dispatch requires an active local project");
      if (
        sub.depends_on.some(
          (dep) => c.get("sub_agenda", dep).status !== "completed",
        )
      )
        throw Error("Complete dependent sub-agenda synthesis first");
      const panel = z
        .array(id)
        .nonempty()
        .parse(params.target_panelist_ids ?? t.panelists.map((p) => p.id));
      if (new Set(panel).size !== panel.length)
        throw Error("Duplicate panelist slots");
      const round = roundType.parse(params.round_type ?? "opening");
      const number = z
        .number()
        .int()
        .positive()
        .parse(
          params.round_number ??
            sub.dispatches.reduce((n, d) => Math.max(n, d.round_number), 0) + 1,
        );
      const targets = z
        .array(id)
        .parse(params.target_contribution_ids ?? [])
        .map((k) => c.get("contribution", k));
      const prompt = z
        .string()
        .min(1)
        .parse(
          params.prompt_full ??
            roundPrompt(hydrate(t), { ...sub, dispatches: [] }, round, targets),
        );
      const d = c.create(
        "dispatch",
        {
          title: params.title ?? sub.title + " · " + round,
          round_number: number,
          round_type: round,
          prompt_summary: params.prompt_summary ?? sub.title,
          prompt_full: prompt,
          target_panelist_ids: panel,
          moderator_name: t.moderator.name,
        },
        subId,
      );
      const runs = panel.map((pid) => {
        const p = t.panelists.find((p) => p.id === pid)!;
        const cfg = config.parse(
          s.panelist_threads[pid] ?? {
            model: p.model || null,
            thinking: p.reasoning_effort,
            harnessId: p.provider || "codex",
          },
        );
        const r: Run = {
          ...makeRun(tid, "panelist", cfg),
          panelistId: pid,
          dispatchId: d.id,
          agendaId: sub.agenda_id,
          subAgendaId: subId,
          roundNumber: number,
          roundType: round,
          contributionKind: contributionKind.parse(
            params.contribution_kind ??
              (["critique", "rebuttal"].includes(round) ? round : "analysis"),
          ),
          targetContributionIds: targets.map((c) => c.id),
          refs: z
            .array(z.string().url())
            .max(16)
            .parse(params.refs ?? []),
        };
        s.runs.push(r);
        c.emit("run.queued", r.id);
        return r;
      });
      c.patch("sub_agenda", subId, {
        status: ["critique", "rebuttal"].includes(round)
          ? "critiquing"
          : "dispatching",
      });
      if (t.status === "draft")
        c.patch("topic", tid, { status: "in_progress" });
      progress(c, subId);
      return { dispatch: { ...d, contributions: [] }, runs };
    });
    this.wake(tid);
    return result;
  }
  async moderate(
    kind: Exclude<RunKind, "panelist">,
    tid: string,
    p: Record<string, unknown>,
  ) {
    const r = await this.store.transaction(tid, (c) => {
      const t = c.tree,
        s = state(t);
      if (t.status === "archived" || !path.isAbsolute(s.project_cwd))
        throw Error("Moderator requires an active local project");
      const cfg = config.parse(
        p.moderator_config ??
          s.moderator_config ?? {
            harnessId: t.moderator.provider || "codex",
            model: t.moderator.model || null,
          },
      );
      const r = makeRun(tid, kind, cfg);
      if (kind === "synthesis") {
        const sub = c.get("sub_agenda", p.subAgendaId);
        r.subAgendaId = sub.id;
        r.agendaId = sub.agenda_id;
        const slots = s.runs.filter(
          (r) => r.kind === "panelist" && r.subAgendaId === sub.id,
        );
        if (
          slots.some(
            (slot) =>
              !slots.some(
                (other) =>
                  other.dispatchId === slot.dispatchId &&
                  other.panelistId === slot.panelistId &&
                  other.status === "completed",
              ),
          )
        )
          throw Error("Outstanding panelist slots");
      } else if (kind === "agenda_conclusion" || p.agendaId)
        r.agendaId = c.get("agenda", p.agendaId).id;
      r.completeTopic = z.boolean().parse(p.completeTopic ?? false);
      r.publishReport = z.boolean().parse(p.publishReport ?? false);
      if (p.prompt) r.task = z.string().parse(p.prompt);
      if (
        s.runs.some(
          (x) =>
            live(x) &&
            x.kind === r.kind &&
            x.agendaId === r.agendaId &&
            x.subAgendaId === r.subAgendaId,
        )
      )
        throw Error("Moderator run already active");
      s.runs.push(r);
      c.emit("run.queued", r.id);
      return r;
    });
    this.wake(tid);
    return r;
  }
  private task(c: Council, r: Run) {
    if (r.kind === "panelist") {
      const p = c.tree.panelists.find((p) => p.id === r.panelistId)!;
      return (
        "You are " +
        p.name +
        " (" +
        p.role +
        ").\n\n" +
        c.get("dispatch", r.dispatchId).prompt_full
      );
    }
    const t = hydrate(c.tree),
      agendas = t.agendas
        .filter((a) => !r.agendaId || a.id === r.agendaId)
        .map((a) => ({
          ...a,
          sub_agendas: a.sub_agendas
            .filter((s) => !r.subAgendaId || s.id === r.subAgendaId)
            .map((s) => ({
              ...s,
              dispatches: s.dispatches.map(({ contributions, ...d }) => d),
            })),
        }));
    const ctx = {
      topic: t.title,
      description: t.description,
      protocol: t.protocol_id,
      roster: t.panelists,
      agendas,
      failed_slots: state(c.tree)
        .runs.filter((r) => r.status === "failed" || r.status === "cancelled")
        .map((r) => ({ id: r.id, panelist: r.panelistId, error: r.error })),
    };
    return [r.task, moderatorPrompt(r.kind, ctx)].filter(Boolean).join("\n\n");
  }
  private async advance(tid: string, rid: string) {
    try {
      const job = await this.edit(tid, rid, (c, r, s) => {
        if (!live(r)) return null;
        if (r.status === "queued") {
          update(c, r, { status: "running", startedAt: now() });
          if (
            r.kind === "panelist" &&
            c.get("sub_agenda", r.subAgendaId).status === "dispatching"
          )
            c.patch("sub_agenda", r.subAgendaId!, { status: "in_progress" });
        }
        const thread =
          r.panelistId && ["critique", "rebuttal"].includes(r.roundType ?? "")
            ? s.panelist_threads[r.panelistId]?.threadId
            : null;
        return {
          r: { ...r },
          thread,
          cwd: s.project_cwd,
          task: r.threadId ? null : this.task(c, r),
        };
      });
      if (!job || this.disposed) return;
      const { r, thread, cwd, task } = job;
      if (r.cancelRequested && (r.threadId || thread)) {
        if (r.threadId) {
          try {
            await this.bridge.cancelThread(r.threadId);
          } catch (e) {
            if (e instanceof HostError && e.transient) {
              await this.activity(tid, rid, e.message);
              return;
            }
            throw e;
          }
        }
        return await this.end(tid, rid, "cancelled", "Cancelled by user");
      }
      if (!r.threadId) {
        let receipt: { threadId: string; turnId?: string };
        if (thread) {
          const before = await this.bridge.readThread(thread);
          if (
            !completedStatus(before.status) &&
            !interrupted(before.status) &&
            before.status !== "failed"
          )
            throw Error("Panelist Thread is busy");
          await this.edit(tid, rid, (c, r) =>
            update(c, r, {
              threadId: thread,
              continuing: true,
              previousTurnId: before.turn?.turnId ?? "",
            }),
          );
          try {
            receipt = await this.bridge.sendThread(thread, task!);
          } catch (e) {
            if (e instanceof HostError && e.transient) {
              await this.activity(
                tid,
                rid,
                "Checking whether Host accepted the turn",
              );
              return;
            }
            throw e;
          }
        } else
          receipt = await this.bridge.delegateStart({
            harness: r.harnessId,
            cwd,
            model: r.model ?? undefined,
            thinking: r.thinking,
            task: task!,
            taskName: r.kind + " · " + (r.panelistId ?? r.topicId),
            refs: r.refs ?? [],
            requestId: r.id,
          });
        if (!receipt.threadId) throw Error("Host returned no Thread ID");
        await this.edit(tid, rid, (c, r, s) => {
          update(c, r, {
            threadId: receipt.threadId,
            ...(receipt.turnId ? { turnId: receipt.turnId } : {}),
          });
          if (r.panelistId)
            s.panelist_threads[r.panelistId] = {
              threadId: receipt.threadId,
              harnessId: r.harnessId,
              model: r.model,
              thinking: r.thinking,
            };
        });
        return;
      }
      let view: ThreadSnapshot;
      try {
        view = await this.bridge.readThread(r.threadId);
      } catch (e) {
        if (e instanceof HostError && e.transient) {
          await this.activity(tid, rid, e.message);
          return;
        }
        throw e;
      }
      if (view.threadId !== r.threadId)
        throw Error("Host returned a different Thread");
      if (
        r.continuing &&
        (!view.turn?.turnId || view.turn.turnId === r.previousTurnId)
      ) {
        if (Date.now() - Date.parse(r.startedAt) > 30000)
          throw Error("Host has not confirmed a new panelist turn");
        return;
      }
      if (r.turnId && view.turn?.turnId && r.turnId !== view.turn.turnId)
        throw Error("Thread advanced to a different turn");
      if (!r.turnId && view.turn?.turnId)
        await this.edit(tid, rid, (c, run) =>
          update(c, run, { turnId: view.turn!.turnId }),
        );
      if (interrupted(view.status) || interrupted(view.turn?.status ?? ""))
        return await this.end(
          tid,
          rid,
          "cancelled",
          view.result?.message || "Thread interrupted",
        );
      if (view.status === "failed" || view.turn?.status === "failed")
        return await this.end(
          tid,
          rid,
          "failed",
          view.result?.message || "Thread failed",
        );
      if (!completedStatus(view.status)) {
        await this.activity(
          tid,
          rid,
          view.progress?.at(-1)?.text || "Thread " + view.status,
        );
        return;
      }
      let output = view.result?.text;
      if (!output?.trim()) {
        const messages = await this.bridge.readThread(r.threadId, "messages"),
          turn = messages.turns?.[0];
        if (
          turn &&
          completedStatus(turn.status) &&
          (!view.turn?.turnId || turn.turnId === view.turn.turnId) &&
          (!r.continuing || turn.turnId !== r.previousTurnId)
        )
          output = turn.messages.findLast(
            (m) => m.role === "agent" && m.text.trim(),
          )?.text;
      }
      if (!output?.trim())
        throw Error(
          view.result?.message || "Thread finished without a final response",
        );
      await this.ingest(tid, rid, output);
    } catch (e) {
      if (!this.disposed)
        await this.end(tid, rid, "failed", (e as Error).message);
    }
  }
  private activity(tid: string, rid: string, message: string) {
    return this.edit(tid, rid, (c, r) => {
      if (!live(r) || r.progressText === message) return;
      update(c, r, { progressText: message.slice(0, 1024) });
      if (r.subAgendaId)
        c.patch("sub_agenda", r.subAgendaId, {
          current_activity: r.progressText,
        });
    });
  }
  private end(
    tid: string,
    rid: string,
    status: "cancelled" | "failed",
    error: string,
  ) {
    return this.edit(tid, rid, (c, r) => {
      if (live(r)) {
        update(c, r, {
          status,
          error: error.slice(0, 1024),
          finishedAt: now(),
        });
        if (r.subAgendaId)
          c.patch("sub_agenda", r.subAgendaId, { current_activity: r.error });
      }
    });
  }
  private ingest(tid: string, rid: string, text: string) {
    return this.edit(tid, rid, (c, r) => {
      if (!live(r) || r.cancelRequested) return;
      const result = extract(text);
      if (r.kind === "panelist") {
        const con = c.create(
          "contribution",
          {
            dispatch_id: r.dispatchId,
            panelist_id: r.panelistId,
            round_number: r.roundNumber,
            kind: r.contributionKind,
            target_contribution_ids: r.targetContributionIds,
            full_content: text,
            ...result,
            duration_ms: Math.max(0, Date.now() - Date.parse(r.startedAt)),
          },
          r.subAgendaId,
        );
        r.contributionId = con.id;
      } else if (r.kind === "synthesis")
        c.patch("sub_agenda", r.subAgendaId!, {
          synthesis_summary: text,
          status: "completed",
          current_activity: "",
        });
      else if (r.kind === "plan") {
        const plan = z
          .array(z.record(z.unknown()))
          .min(1)
          .parse(structured(text).agendas);
        for (const a of plan) c.create("agenda", a, tid, false);
        validateDependencies(c.tree);
        c.rollup();
      } else {
        let body = text,
          title = c.tree.title;
        if (r.agendaId) title = c.get("agenda", r.agendaId).title;
        if (r.kind === "agenda_conclusion") {
          const data = z
            .object({
              conclusion_summary: z.string().min(1),
              conclusion_key_points: points,
              open_disagreements: points,
            })
            .parse(structured(text));
          c.patch("agenda", r.agendaId!, { ...data, status: "completed" });
          body = [
            data.conclusion_summary,
            ...data.conclusion_key_points.map((p) => "- " + p),
            ...data.open_disagreements.map((p) => "- " + p),
          ].join("\n\n");
        }
        if (r.kind === "report" || r.publishReport)
          r.reportId = c.create(
            "report",
            { title, agenda_id: r.agendaId ?? null, markdown_content: body },
            tid,
          ).id;
        if (r.kind === "report" && !r.agendaId && r.completeTopic)
          c.patch("topic", tid, {
            executive_summary: result.summary,
            key_takeaways: result.key_points,
            status: "completed",
          });
      }
      update(c, r, { status: "completed", finishedAt: now() });
      if (r.kind === "panelist") progress(c, r.subAgendaId!);
    });
  }
  async cancel(tid: string, rid: string) {
    const r = await this.edit(tid, rid, (c, r) => {
      if (!live(r)) throw Error("Run is already terminal");
      if (r.status === "queued")
        update(c, r, {
          status: "cancelled",
          finishedAt: now(),
          error: "Cancelled before dispatch",
        });
      else
        update(c, r, {
          cancelRequested: true,
          progressText: "Cancellation requested",
        });
      return r;
    });
    this.wake(tid);
    return r;
  }
  async retry(tid: string, rid: string) {
    const next = await this.edit(tid, rid, (c, r, s) => {
      if (c.tree.status === "archived")
        throw Error("Cannot retry an archived run");
      if (
        !["cancelled", "failed"].includes(r.status) ||
        s.runs.some((x) => x.retryOf === rid)
      )
        throw Error("Retry the latest failed or cancelled attempt");
      const {
        error,
        finishedAt,
        threadId,
        previousTurnId,
        turnId,
        cancelRequested,
        continuing,
        progressText,
        ...previous
      } = r;
      const next: Run = {
        ...previous,
        id: uid(),
        retryOf: rid,
        threadId: null,
        status: "queued",
        startedAt: now(),
        updatedAt: now(),
      };
      s.runs.push(next);
      c.emit("run.queued", next.id);
      return next;
    });
    this.wake(tid);
    return next;
  }
  async runs(tid: string) {
    return this.store.serial(
      async () => state(await this.store.load(tid)).runs,
    );
  }
  async dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    this.timer = undefined;
    this.bridge.dispose();
    await this.cycle;
    await Promise.allSettled(this.inFlight.values());
    await this.store.drain();
  }
}
