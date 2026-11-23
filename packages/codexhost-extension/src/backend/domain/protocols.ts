import { translate, type Locale } from "../../shared/i18n.ts";
import type { Topic, SubAgenda, Contribution } from "./models.ts";

const definitions = [
  [
    "council-standard",
    "Standard Council",
    "Independent analysis, peer critique and synthesis.",
    ["opening", "critique", "synthesis_request"],
    "parallel",
  ],
  [
    "adversarial-debate",
    "Adversarial Debate",
    "Sequential claims, challenges and rebuttals.",
    ["opening", "critique", "rebuttal", "synthesis_request"],
    "sequential",
  ],
  [
    "rapid-panel",
    "Rapid Panel",
    "One independent response from each expert.",
    ["opening"],
    "parallel",
  ],
] as const;
export const protocols = definitions.map(
  ([id, name, description, default_phases, execution_mode]) => ({
    id,
    name,
    description,
    default_phases,
    execution_mode,
    recommended_rounds: default_phases.length,
    schema_hints: { execution_mode, round_types: default_phases },
  }),
);
export function capabilities(methods: string[]) {
  return {
    service: "the-althing",
    api_version: "1.0.0",
    protocol_version: "1.0",
    skills_distributed_by_server: false,
    public_base_url: "",
    auth: {
      read_requires_key: false,
      write_requires_key: false,
      header: "",
      alternative_header: "",
    },
    features: {
      live_sse: false,
      agenda_hierarchy: true,
      parallel_sub_agendas: true,
      peer_critique_rounds: true,
      summary_with_expandable_fulltext: true,
      agenda_reports: true,
      final_reports: true,
      standalone_html_reports: true,
      archive_export: true,
      archive_import: true,
      runtime_themes: false,
      plugin_registry: false,
    },
    protocols,
    exporters: [
      ["archive-zip", "Portable Archive", "application/zip", "zip"],
      ["markdown-bundle", "Markdown Bundle", "application/zip", "zip"],
      ["standalone-html", "Standalone HTML", "text/html", "html"],
    ].map(([id, name, media_type, extension]) => ({
      id,
      name,
      media_type,
      extension,
    })),
    report_renderers: [
      { id: "authored-html", format: "html" },
      { id: "editorial-markdown", format: "markdown" },
    ],
    themes: ["editorial-paper", "cool-slate", "obsidian-night"].map((id) => ({
      id,
      name: id,
    })),
    endpoints: Object.fromEntries(
      methods.map((path) => [path, { method: "invoke", path }]),
    ),
  };
}
export function roundPrompt(
  t: Topic,
  s: SubAgenda,
  type: string,
  targets: Contribution[],
  locale: Locale = "en",
) {
  const l = (en: string, zh: string) => translate(locale, en, zh);
  const instruction =
    type === "critique"
      ? l(
          "Identify the strongest supported claim, a consequential disagreement, and an observation that could resolve it. Cite the public contribution IDs.",
          "指出证据最充分的主张、一个重要分歧，以及能够澄清分歧的观察。引用公开发言的 ID。",
        )
      : type === "rebuttal"
        ? l(
            "Address the cited critique. State your revised conclusion, what evidence changed it, and what remains unresolved.",
            "回应引用的质询，说明修订后的结论、促使你改判的证据，以及未解决的问题。",
          )
        : l(
            "Give your independent public assessment, evidence for each finding, assumptions, and unresolved uncertainty.",
            "给出独立的公开评估，说明每项结论的证据、前提假设和尚存的不确定性。",
          );
  return [
    t.title,
    t.description,
    s.title,
    s.prompt_framing,
    ...t.agendas
      .flatMap((a) => a.sub_agendas)
      .filter((dep) => s.depends_on.includes(dep.id))
      .map((dep) => dep.id + " / " + dep.synthesis_summary),
    instruction,
    ...targets.map(
      (c) => c.id + " / " + c.panelist_name + "\n" + c.full_content,
    ),
    l(
      "Return public Markdown with a concise lead, 3–5 principal findings as bullets, and optional Stance tags: on the last line.",
      "使用 Markdown，以简短摘要开头，用列表列出 3–5 项主要发现。可在末行用 Stance tags: 标注立场。",
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
}
export function moderatorPrompt(kind: string, context: unknown) {
  const instructions: Record<string, string> = {
    synthesis:
      "Synthesize the evidence, consensus, minority positions and remaining uncertainty in Markdown.",
    agenda_conclusion:
      "Return only one JSON object, without commentary or a code fence. Use conclusion_summary (a non-empty string), conclusion_key_points (string[]) and open_disagreements (string[]). Each array item must be a plain string, never a nested object. Include response IDs inline in those strings. Use [] when there are no items.",
    report:
      "Write a standalone Markdown report covering methods, evidence, implications, and uncertainty. Link each relevant agenda conclusion.",
    plan: "Return only one JSON object, without commentary or a code fence. Its agendas field is a non-empty array of objects. Each agenda has a title (non-empty string), objective (string) and sub_agendas (array). Each sub-agenda has a title (non-empty string), prompt_framing (string) and execution_mode (parallel or sequential). You may give agendas and sub-agendas string IDs in id. Set depends_on only on sub-agendas, to a string[] of other sub-agenda IDs in this topic.",
  };
  return [
    instructions[kind],
    "Attribute claims to public response IDs. Identify the roster and all failed or omitted slots.",
    JSON.stringify(context),
  ].join("\n\n");
}
