export function formatFileContent(path: string, content: string) {
  if (path.endsWith(".json")) {
    try {
      return { kind: "json" as const, content: JSON.stringify(JSON.parse(content), null, 2) };
    } catch {
      return { kind: "text" as const, content };
    }
  }
  if (path.endsWith(".md")) return { kind: "markdown" as const, content };
  return { kind: "text" as const, content };
}

