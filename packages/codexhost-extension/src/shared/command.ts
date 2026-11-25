export type CouncilProtocolId =
  | "council-standard"
  | "adversarial-debate"
  | "rapid-panel";

export type ParsedCouncilCommand = {
  raw: string;
  prompt: string;
  protocol?: CouncilProtocolId;
  custom: boolean;
  expertCount?: number;
};

const leadingCommand = /^\s*[/／]althing(?=$|[\s\u00A0])([\s\S]*)$/i;
const flagToken =
  /^--(debate|adversarial|rapid|quick|standard|custom|manual|experts)(?:=(\d+))?(?=$|[\s\u00A0])([\s\S]*)$/i;

export function isCouncilCommandPrefix(text: string): boolean {
  const trimmed = text.trim().replace(/^／/, "/").toLowerCase();
  return (
    trimmed.length > 0 &&
    trimmed.startsWith("/") &&
    "/althing".startsWith(trimmed)
  );
}

export function parseCouncilCommand(text: string): ParsedCouncilCommand | null {
  const match = leadingCommand.exec(text);
  if (!match) return null;
  let rest = (match[1] ?? "").trim();
  let protocol: CouncilProtocolId | undefined;
  let custom = false;
  let expertCount: number | undefined;

  while (rest.startsWith("--")) {
    const flag = flagToken.exec(rest);
    if (!flag) break;
    const name = flag[1].toLowerCase();
    const inlineValue = flag[2];
    rest = (flag[3] ?? "").trim();
    if (name === "debate" || name === "adversarial")
      protocol = "adversarial-debate";
    else if (name === "rapid" || name === "quick") protocol = "rapid-panel";
    else if (name === "standard") protocol = "council-standard";
    else if (name === "custom" || name === "manual") custom = true;
    else if (name === "experts") {
      let value = inlineValue;
      if (!value) {
        const nextNum = /^([1-6])(?=$|[\s\u00A0])([\s\S]*)$/.exec(rest);
        if (nextNum) {
          value = nextNum[1];
          rest = (nextNum[2] ?? "").trim();
        }
      }
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 6)
        expertCount = parsed;
    }
  }

  return {
    raw: text.trim(),
    prompt: rest,
    ...(protocol ? { protocol } : {}),
    custom,
    ...(expertCount ? { expertCount } : {}),
  };
}

export function splitPrompt(raw: string): {
  title: string;
  description: string;
} {
  const normalized = raw.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return { title: "", description: "" };
  const lines = normalized.split("\n");
  const firstIndex = lines.findIndex((line) => line.trim().length > 0);
  const firstLine = (firstIndex >= 0 ? lines[firstIndex] : normalized).trim();
  const rest = lines
    .slice(firstIndex + 1)
    .join("\n")
    .trim();

  if (firstLine.length <= 140) {
    return { title: firstLine, description: rest };
  }

  const sentenceBreak = /^(.{18,136}?[。！？.!?])(?:\s|$)/.exec(firstLine);
  const title = sentenceBreak
    ? sentenceBreak[1].trim()
    : firstLine.slice(0, 137).trimEnd() + "…";
  return {
    title,
    description: normalized,
  };
}
