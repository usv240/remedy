/** "claude-opus-5-5" -> "Claude Opus 5.5", for plain copy. Client-safe; the raw id stays in Technical view and the API. */
export function modelName(id: string | null | undefined): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id ?? "");
  if (!m) return id || "Claude";
  return `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}
