// Markdown → something a voice can read. Code blocks are skipped (nobody wants a Dockerfile read to
// them), tables become comma lists, links keep their text, emphasis marks go, and long replies are
// cut at a sentence boundary with "…and so on."

/**
 * @param {string} markdown
 * @param {{ maxChars?: number }} [opts]
 * @returns {{ text: string, truncated: boolean }}
 */
export function speakable(markdown, { maxChars = 1000 } = {}) {
  let t = String(markdown ?? "");
  t = t.replace(/<!--[\s\S]*?-->/g, " ");
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/~~~[\s\S]*?~~~/g, " ");
  t = t.replace(/^[ \t]*\|.*\|[ \t]*$/gm, (line) =>
    /^[\s|:-]+$/.test(line) ? "" : line.replace(/^\s*\||\|\s*$/g, "").replace(/\s*\|\s*/g, ", "),
  );
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  t = t.replace(/https?:\/\/\S+/g, "link");
  t = t.replace(/`([^`\n]+)`/g, "$1");
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");
  t = t.replace(/^[ \t]*>[ \t]?/gm, "");
  t = t.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, "");
  t = t.replace(/\*\*|__/g, "");
  t = t.replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, " ");
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, " ");
  t = t.replace(/[ \t]+/g, " ");
  t = t
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (/[.!?…:;]$/.test(line) ? line : `${line}.`))
    .join(" ");

  let truncated = false;
  if (t.length > maxChars) {
    const cut = t.slice(0, maxChars);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    t = `${end > maxChars * 0.5 ? cut.slice(0, end + 1) : cut.trimEnd()} …and so on.`;
    truncated = true;
  }
  return { text: t, truncated };
}

/** The last assistant message in a Claude Code transcript (JSONL), for hosts that don't pass it directly. */
export function lastAssistantMessage(transcriptText) {
  const lines = String(transcriptText ?? "").split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (entry.type !== "assistant") continue;
    const content = entry.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const text = content.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n");
      if (text.trim()) return text;
    }
  }
  return "";
}
