import { modelLabel, type Agent, type AgentModel } from "../shared/agents.ts";
import { splitPrompt, type CouncilProtocolId } from "../shared/command.ts";
import { translate, type Locale } from "../shared/i18n.ts";
import { uid } from "./domain/models.ts";

export type RecommendedSeat = {
  id: string;
  name: string;
  role: string;
  model: string;
  provider: string;
  reasoning_effort: string;
};

export type RecommendedHostConfig = {
  panelist_threads: Record<
    string,
    { harnessId: string; model: AgentModel | null; thinking: string }
  >;
  moderator_config: {
    harnessId: string;
    model: AgentModel | null;
    thinking: string;
  } | null;
  moderator_display: { role: string; reasoning_effort: string } | null;
};

export type PanelRecommendation = {
  workspace: string;
  workspaceLabel: string;
  title: string;
  description: string;
  protocol: CouncilProtocolId;
  domain: "debate" | "engineering" | "product" | "general";
  readyCount: number;
  seatCount: number;
  panelists: RecommendedSeat[];
  moderator: { name?: string; model?: string; provider?: string };
  host: RecommendedHostConfig;
};

type RoleSpec = readonly [en: string, zh: string, shortEn: string, shortZh: string];

const roleTemplates: Record<PanelRecommendation["domain"], readonly RoleSpec[]> = {
  debate: [
    ["Proponent & case builder", "正方主辩", "Proponent", "正方"],
    ["Opponent & counter-argument lead", "反方主辩", "Opponent", "反方"],
    ["Evidence & risk auditor", "证据与风险审查", "Auditor", "审查"],
    ["Edge-case & compromise analyst", "边界条件与折中评估", "Mediator", "折中"],
    ["Domain context reviewer", "领域背景核查", "Context", "背景"],
    ["Execution impact assessor", "落地影响评估", "Impact", "影响"],
  ],
  engineering: [
    ["Systems architect", "系统架构师", "Architect", "架构"],
    ["Engineering & performance lead", "工程落地与性能专家", "Engineering", "工程"],
    ["Red team & security critic", "红队质询与安全风控", "Red Team", "红队"],
    ["Developer experience & maintainability", "开发者体验与可维护性", "DX", "体验"],
    ["Data & reliability specialist", "数据一致性与可靠性", "Reliability", "可靠"],
    ["Cost & operations analyst", "成本与运维评估", "Ops", "运维"],
  ],
  product: [
    ["Product strategist", "产品策略专家", "Strategy", "策略"],
    ["UX & workflow designer", "用户体验与交互专家", "UX", "交互"],
    ["Critical challenger & risk analyst", "反向质询与风险评估", "Critic", "质询"],
    ["Technical feasibility lead", "技术可行性与落地专家", "Feasibility", "落地"],
    ["Go-to-market & adoption advisor", "推广与采用策略顾问", "Adoption", "推广"],
    ["Metrics & validation reviewer", "指标与验证评估", "Metrics", "验证"],
  ],
  general: [
    ["Domain lead & primary analyst", "主领域研究专家", "Lead", "主研"],
    ["Methodology & evidence reviewer", "方法论与证据审查", "Methods", "方法"],
    ["Red team & blind-spot critic", "红队质询与盲点审视", "Critic", "质询"],
    ["Practical implementation advisor", "可行性与落地顾问", "Advisor", "落地"],
    ["Long-term impact & trade-off analyst", "长期影响与权衡分析", "Trade-offs", "权衡"],
    ["Cross-domain synthesizer", "跨领域综合评审", "Review", "综合"],
  ],
};

const zhDigits: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};

const debatePattern =
  /(?:^|\b)(?:debate|adversarial|pro[\s/-]*con|pros?\s+and\s+cons?|red[\s-]*team)(?:\b|$)|辩论|辯論|对抗|對抗|正反方|反方|紅隊|红队|対抗討論|賛否|ディベート|찬반|대립\s*토론/i;
const rapidPattern =
  /(?:^|\b)(?:rapid|quick\s+(?:panel|check|review|take)|fast\s+review)(?:\b|$)|快速(?:评审|评估|专家组|过一下|讨论|分析)|迅速|クイック|신속/i;
const engineeringPattern =
  /(?:^|\b)(?:api|arch|architecture|backend|frontend|rust|golang|typescript|python|react|database|sql|postgres|sqlite|redis|cache|sync|crdt|ot|migrat\w*|perf\w*|latency|scale|scalability|infra|docker|k8s|kubernetes|security|auth|mcp|agent|sdk|cli|plugin|extension|codebase|refactor|microservice|monolith|queue|stream|rpc|protocol|runtime|mobile|ios|android|webkit)(?:\b|$)|系统|架构|架構|后端|後端|前端|数据库|資料庫|缓存|快取|同步|迁移|遷移|性能|效能|安全|代码|程式碼|重构|重構|接口|插件|服务|服務|分布式|分散式|并发|併發|アーキテクチャ|実装|性能|아키텍처|구현|성능/i;
const productPattern =
  /(?:^|\b)(?:ux|ui|product|user|onboard\w*|design|growth|pricing|market|business|strategy|customer|funnel|retention|copy|brand|feature|workflow|roadmap|ergonomics)(?:\b|$)|产品|產品|体验|體驗|交互|互動|设计|設計|用户|用戶|增长|增長|定价|定價|商业|商業|策略|市场|市場|运营|營運|流程|需求|转化|留存|ユーザー体験|製品|사용자\s*경험|제품/i;

export function detectPromptHints(
  prompt: string,
  defaultProtocol: CouncilProtocolId = "council-standard",
): { protocol: CouncilProtocolId; expertCount?: number } {
  let protocol: CouncilProtocolId = defaultProtocol;
  if (debatePattern.test(prompt)) protocol = "adversarial-debate";
  else if (rapidPattern.test(prompt)) protocol = "rapid-panel";

  let expertCount: number | undefined;
  const patterns = [
    /\b([1-6])\s*(?:experts?|panelists?|agents?|models?|seats?|reviewers?|perspectives?)\b/i,
    /([1-6一二两兩三四五六])\s*(?:位|个|個|名|席)\s*(?:专家|專家|模型|席位|Agent|智能体|智能體|辩手|辯手)/i,
    /([1-6])\s*(?:人|名)の?(?:専門家|エージェント|モデル)/,
    /([1-6])\s*명의?\s*(?:전문가|에이전트|모델)/,
  ];
  for (const rx of patterns) {
    const m = rx.exec(prompt);
    if (!m) continue;
    const raw = m[1];
    const parsed = zhDigits[raw] ?? Number(raw);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 6) {
      expertCount = parsed;
      break;
    }
  }
  return { protocol, ...(expertCount ? { expertCount } : {}) };
}

export function classifyDomain(
  prompt: string,
  protocol: CouncilProtocolId,
): PanelRecommendation["domain"] {
  if (protocol === "adversarial-debate") return "debate";
  if (engineeringPattern.test(prompt)) return "engineering";
  if (productPattern.test(prompt)) return "product";
  return "general";
}

export function recommendPanel(options: {
  prompt?: string;
  agents: Agent[];
  workspace?: string;
  workspaceLabel?: string;
  protocol?: CouncilProtocolId;
  defaultProtocol?: CouncilProtocolId;
  expertCount?: number;
  locale?: Locale;
}): PanelRecommendation {
  const locale = options.locale ?? "en";
  const rawPrompt = (options.prompt ?? "").trim();
  const { title, description } = splitPrompt(rawPrompt);
  const fallbackProtocol = options.defaultProtocol ?? "council-standard";
  const hints = detectPromptHints(rawPrompt, fallbackProtocol);
  const protocol = options.protocol ?? hints.protocol;
  const domain = classifyDomain(rawPrompt, protocol);

  const ready = options.agents.filter((a) => a.status === "ready");
  const collaborative = ready.filter((a) => a.configuredForDelegation);
  const pool = collaborative.length
    ? [...collaborative, ...ready.filter((a) => !a.configuredForDelegation)]
    : ready;

  if (!pool.length) {
    return {
      workspace: options.workspace ?? "",
      workspaceLabel: options.workspaceLabel ?? "",
      title,
      description,
      protocol,
      domain,
      readyCount: 0,
      seatCount: 0,
      panelists: [],
      moderator: {},
      host: {
        panelist_threads: {},
        moderator_config: null,
        moderator_display: null,
      },
    };
  }

  const requestedCount = options.expertCount ?? hints.expertCount;
  const complex =
    rawPrompt.length >= 100 ||
    rawPrompt.includes("\n") ||
    (rawPrompt.match(/[,，;；?？、]/g)?.length ?? 0) >= 2;

  let seatCount: number;
  if (requestedCount) {
    seatCount = Math.max(1, Math.min(6, requestedCount));
  } else if (protocol === "rapid-panel") {
    seatCount = Math.min(3, pool.length);
  } else if (pool.length >= 4 && complex) {
    seatCount = 4;
  } else if (pool.length >= 3) {
    seatCount = 3;
  } else if (pool.length === 2) {
    seatCount = protocol === "adversarial-debate" ? 3 : 2;
  } else {
    seatCount = 2;
  }

  const specs = roleTemplates[domain];
  const usageCounts = new Map<string, number>();
  const picked: Agent[] = Array.from({ length: seatCount }, (_, i) => {
    const agent = pool[i % pool.length];
    usageCounts.set(agent.id, (usageCounts.get(agent.id) ?? 0) + 1);
    return agent;
  });

  const panelists: RecommendedSeat[] = [];
  const panelistThreads: RecommendedHostConfig["panelist_threads"] = {};

  for (let i = 0; i < seatCount; i++) {
    const agent = picked[i];
    const spec = specs[i % specs.length];
    const role = translate(locale, spec[0], spec[1]);
    const shortRole = translate(locale, spec[2], spec[3]);
    const seatId = uid();
    const duplicated = (usageCounts.get(agent.id) ?? 0) > 1;
    panelists.push({
      id: seatId,
      name: duplicated ? `${agent.label} · ${shortRole}` : agent.label,
      role,
      model: modelLabel(agent, agent.defaultModel),
      provider: agent.id,
      reasoning_effort: agent.defaultThinkingLabel,
    });
    panelistThreads[seatId] = {
      harnessId: agent.id,
      model: agent.defaultModel,
      thinking: agent.defaultThinking,
    };
  }

  const chair = pool[0];
  return {
    workspace: options.workspace ?? "",
    workspaceLabel: options.workspaceLabel ?? "",
    title,
    description,
    protocol,
    domain,
    readyCount: pool.length,
    seatCount,
    panelists,
    moderator: {
      name: translate(locale, "Moderator", "主持人"),
      model: modelLabel(chair, chair.defaultModel),
      provider: chair.id,
    },
    host: {
      panelist_threads: panelistThreads,
      moderator_config: {
        harnessId: chair.id,
        model: chair.defaultModel,
        thinking: chair.defaultThinking,
      },
      moderator_display: {
        role: translate(locale, "Council chair", "议会主持人"),
        reasoning_effort: chair.defaultThinkingLabel,
      },
    },
  };
}
