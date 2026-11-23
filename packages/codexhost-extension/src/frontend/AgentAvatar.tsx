import type { CSSProperties } from "react";
import { Crown } from "lucide-react";
import { brandIcons } from "./brand-icons";

const brands = [
  {
    name: "OpenAI",
    icon: "openai",
    color: "#d9f3e7",
    matches: /openai|chatgpt|\bgpt(?:\b|\d)|\bcodex\b|\bo[134]\b/i,
  },
  {
    name: "Gemini",
    icon: "gemini-color",
    color: "#e0edff",
    matches: /gemini|google|antigravity|\bagy\b/i,
  },
  {
    name: "Grok",
    icon: "grok",
    color: "#e6eaf4",
    matches: /grok|\bxai\b|x\.ai/i,
  },
  {
    name: "Claude",
    icon: "claude-color",
    color: "#ffebdc",
    matches: /claude|anthropic/i,
  },
  {
    name: "DeepSeek",
    icon: "deepseek-color",
    color: "#e4edff",
    matches: /deepseek|深度求索/i,
  },
  {
    name: "Qwen",
    icon: "qwen-color",
    color: "#eee8ff",
    matches: /qwen|通义千问/i,
  },
];

type AgentIdentity = {
  name: string;
  model?: string;
  provider?: string;
  id?: string;
  chair?: boolean;
  size?: number;
};

export function AgentAvatar({
  name,
  model,
  provider,
  id,
  chair = false,
  size = 38,
}: AgentIdentity) {
  // A model routed through a third-party provider retains its own identity.
  const brand = [model, name, id, provider]
    .map((value) => value && brands.find((item) => item.matches.test(value)))
    .find((item) => typeof item === "object");
  const initial = Array.from((name || id || "?").trim())[0] || "?";
  return (
    <span
      className="agent-avatar"
      aria-hidden="true"
      title={brand?.name || name}
      style={
        {
          "--avatar-size": size + "px",
          "--avatar-fill": brand?.color || "#f3ecff",
        } as CSSProperties
      }
    >
      {brand ? (
        <img src={brandIcons[brand.icon]} alt="" />
      ) : (
        initial.toLocaleUpperCase()
      )}
      {chair && (
        <span className="agent-chair-pin">
          <Crown />
        </span>
      )}
    </span>
  );
}
