import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Validator, type Schema } from "@cfworker/json-schema";
import topicDocument from "../../../../protocol/topic.schema.json" with { type: "json" };
import capabilitiesDocument from "../../../../protocol/capabilities.schema.json" with { type: "json" };
export const topicTreeSchema = new Validator(
  topicDocument as Schema,
  "2020-12",
);
export const capabilitiesSchema = new Validator(
  capabilitiesDocument as Schema,
  "2020-12",
);

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [k: string]: Json };
export const json: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(json),
    z.record(json),
  ]),
);
export const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/u);
export const uid = () => randomUUID().replaceAll("-", "");
export const now = () => new Date().toISOString();
const title = z
  .string()
  .regex(/^[\s\S]{1,500}$/u, "Expected 1 to 500 Unicode characters");
const str = z.string().default("");
const strings = z.array(z.string()).default([]);
const ids = z.array(id).default([]);
const round = z.number().int().min(1).default(1);
const ref = id.nullable().default(null);
const completed = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .default(null);
const resource = { id: id.default(uid) };
const progress = {
  progress_pct: z.number().int().min(0).max(100).nullable().default(null),
  current_activity: z.string().nullable().default(null),
  completed_at: completed,
};
const ordered = {
  ...resource,
  title,
  code: str,
  order_index: z.number().int().nullable().default(null),
  ...progress,
};
export const moderator = z
  .object({ name: str, model: str, provider: str })
  .strict();
export const panelist = moderator.extend({
  id,
  name: title,
  subscription: str,
  reasoning_effort: str,
  role: str,
  color_token: str,
});
export const subAgenda = z
  .object({
    ...ordered,
    prompt_framing: str,
    execution_mode: z.enum(["parallel", "sequential"]).default("parallel"),
    depends_on: ids,
    status: z
      .enum([
        "pending",
        "dispatching",
        "in_progress",
        "critiquing",
        "completed",
      ])
      .default("pending"),
    synthesis_summary: str,
  })
  .strict();
export const agenda = z
  .object({
    ...ordered,
    objective: str,
    status: z
      .enum(["pending", "in_progress", "critiquing", "completed"])
      .default("pending"),
    conclusion_summary: str,
    conclusion_key_points: strings,
    open_disagreements: strings,
    report_id: ref,
    sub_agendas: z.array(subAgenda).default([]),
  })
  .strict();
export const topic = z
  .object({
    ...resource,
    title,
    subtitle: str,
    description: str,
    domain_tags: strings,
    protocol_id: z.string().default("council-standard"),
    status: z
      .enum(["draft", "in_progress", "synthesizing", "completed", "archived"])
      .default("draft"),
    ...progress,
    moderator: moderator.default({}),
    panelists: z
      .array(panelist)
      .refine(
        (p) => new Set(p.map((x) => x.id)).size === p.length,
        "Panelist IDs must be unique within a topic",
      )
      .default([]),
    executive_summary: str,
    key_takeaways: strings,
    final_report_id: ref,
    metadata: z.record(json).default({}),
    agendas: z.array(agenda).default([]),
  })
  .strict();
export const roundType = z.enum([
  "opening",
  "critique",
  "rebuttal",
  "synthesis_request",
  "custom",
]);
export const contributionKind = z.enum([
  "analysis",
  "critique",
  "rebuttal",
  "verification",
  "supplement",
]);
export const dispatch = z
  .object({
    ...resource,
    title,
    round_number: round,
    round_type: roundType.default("opening"),
    moderator_name: str,
    prompt_summary: z.string(),
    prompt_full: z.string(),
    target_panelist_ids: ids,
  })
  .strict();
export const contribution = z
  .object({
    ...resource,
    dispatch_id: ref,
    panelist_id: id,
    panelist_name: str,
    model: str,
    provider: str,
    subscription: str,
    reasoning_effort: str,
    role: str,
    round_number: round,
    kind: contributionKind.default("analysis"),
    summary: z.string().min(1),
    key_points: strings,
    stance_tags: strings,
    full_content: z.string().min(1),
    target_contribution_ids: ids,
    duration_ms: z.number().int().nonnegative().nullable().default(null),
    token_usage: z.record(json).nullable().default(null),
  })
  .strict();
const reportFields = z
  .object({
    ...resource,
    title,
    subtitle: str,
    agenda_id: ref,
    report_type: z.enum(["agenda", "final", "custom"]).nullable().default(null),
    version: z.string().default("1"),
    format: z.enum(["html", "markdown"]).nullable().default(null),
    markdown_content: str,
    html_content: str,
    set_as_primary: z.boolean().default(true),
  })
  .strict();
export const report = reportFields.superRefine((r, ctx) => {
  if (!(r.html_content.trim() || r.markdown_content.trim()))
    ctx.addIssue({
      code: "custom",
      message: "Provide html_content or markdown_content",
    });
  if (
    (r.report_type === "agenda" && !r.agenda_id) ||
    (r.report_type === "final" && r.agenda_id)
  )
    ctx.addIssue({
      code: "custom",
      message: "report_type and agenda_id disagree",
    });
});
export const models = {
  topic,
  agenda,
  sub_agenda: subAgenda,
  dispatch,
  contribution,
  report,
};
export const fields = {
  topic: topic.shape,
  agenda: agenda.shape,
  sub_agenda: subAgenda.shape,
  dispatch: dispatch.shape,
  contribution: contribution.shape,
  report: reportFields.shape,
};
export type Kind = keyof typeof models;
export const archive = z.object({
  id,
  topic_id: id,
  title,
  format: z.literal("zip"),
  file_name: z.string(),
  file_size_bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  created_at: z.string().datetime({ offset: true }),
  metadata: z.record(json),
  download_url: z.string(),
  preview_url: z.string(),
});
export type Archive = z.infer<typeof archive>;
export type Moderator = z.infer<typeof moderator>;
export type Panelist = z.infer<typeof panelist>;
type Stamp = { created_at: string; updated_at: string };
type Progress = {
  progress_pct: number;
  current_activity: string;
  pinned_fields?: string[];
};
export type Contribution = z.infer<typeof contribution> &
  Stamp & { topic_id: string; agenda_id: string; sub_agenda_id: string };
export type Dispatch = z.infer<typeof dispatch> &
  Stamp & {
    topic_id: string;
    agenda_id: string;
    sub_agenda_id: string;
    contributions: Contribution[];
  };
export type SubAgenda = z.infer<typeof subAgenda> &
  Progress &
  Stamp & {
    topic_id: string;
    agenda_id: string;
    dispatches: Dispatch[];
    contributions: Contribution[];
  };
export type Agenda = Omit<z.infer<typeof agenda>, "sub_agendas"> &
  Progress &
  Stamp & { topic_id: string; sub_agendas: SubAgenda[] };
export type Report = Omit<
  z.infer<typeof report>,
  "set_as_primary" | "markdown_content" | "html_content"
> &
  Stamp & {
    topic_id: string;
    report_type: "agenda" | "final" | "custom";
    format: "html" | "markdown";
    source_html?: string;
    markdown_content?: string;
    html_content?: string;
  };
export type Counts = {
  agenda_count: number;
  completed_agendas: number;
  sub_agenda_count: number;
  completed_sub_agendas: number;
  contribution_count: number;
  report_count: number;
  archive_count: number;
  active_agendas: string[];
};
export type Topic = Omit<z.infer<typeof topic>, "agendas"> &
  Progress &
  Stamp &
  Counts & { agendas: Agenda[]; reports: Report[]; archives: Archive[] };
const count = z.number().int().nonnegative();
export const card = topic
  .pick({
    id: true,
    title: true,
    subtitle: true,
    description: true,
    status: true,
    domain_tags: true,
    protocol_id: true,
    panelists: true,
    final_report_id: true,
  })
  .extend({
    progress_pct: z.number().int().min(0).max(100),
    current_activity: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    agenda_count: count,
    completed_agendas: count,
    sub_agenda_count: count,
    completed_sub_agendas: count,
    contribution_count: count,
    report_count: count,
    archive_count: count,
    active_agendas: z.array(z.string()),
    projectCwd: z.string(),
    projectLabel: z.string(),
    latest_archive: archive.nullable(),
    activeRunCount: count,
  });
export type Card = z.infer<typeof card>;
export type Capabilities = ReturnType<
  typeof import("./protocols.ts").capabilities
>;
export const reportHead = ({
  html_content,
  markdown_content,
  source_html,
  ...head
}: Report): Report => head;
