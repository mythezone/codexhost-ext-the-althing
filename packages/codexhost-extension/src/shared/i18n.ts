import translations from "./translations.json" with { type: "json" };

export type Locale = "en" | "zh-CN" | "zh-TW" | "ja" | "ko";

export function resolveLocale(host?: unknown, preference?: unknown): Locale {
  const raw =
    typeof preference === "string" && preference && preference !== "auto"
      ? preference
      : host;
  const tag =
    typeof raw === "string"
      ? raw.trim().replaceAll("_", "-").toLowerCase()
      : "";
  const [language, ...parts] = tag.split("-");
  if (language === "ja" || language === "ko") return language;
  if (language === "zh") {
    if (parts.includes("hant")) return "zh-TW";
    if (parts.includes("hans")) return "zh-CN";
    if (parts.some((p) => ["tw", "hk", "mo"].includes(p))) return "zh-TW";
    if (!parts.length || parts.some((p) => p === "cn" || p === "sg"))
      return "zh-CN";
  }
  return "en";
}

const catalog: Record<string, readonly string[]> = translations;
const column = { "zh-TW": 0, ja: 1, ko: 2 } as const;
export function translate(locale: Locale, english: string, simplified: string) {
  if (locale === "en") return english;
  if (locale === "zh-CN") return simplified;
  return Object.hasOwn(catalog, simplified)
    ? catalog[simplified][column[locale]]
    : english;
}
