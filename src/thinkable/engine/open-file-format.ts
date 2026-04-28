const DEFAULT_OPEN_FILE_LINES = 200;
const DEFAULT_OPEN_FILE_COLUMNS = 200;

function normalizeOpenFileLimit(value: unknown, defaultValue: number): number | null {
  if (value === -1) return null;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : defaultValue;
}

export function formatOpenFileContent(
  raw: string,
  options: { lines?: unknown; columns?: unknown },
): { content: string; linesLimit: number | null; columnsLimit: number | null } {
  const linesLimit = normalizeOpenFileLimit(options.lines, DEFAULT_OPEN_FILE_LINES);
  const columnsLimit = normalizeOpenFileLimit(options.columns, DEFAULT_OPEN_FILE_COLUMNS);

  const allLines = raw.split("\n");
  const visibleLines = linesLimit === null ? allLines : allLines.slice(0, linesLimit);
  const formatted = visibleLines.map((line) => {
    if (columnsLimit === null || line.length <= columnsLimit) return line;
    const omitted = line.length - columnsLimit;
    return `${line.slice(0, columnsLimit)}... （超长省略后续 ${omitted} 字符）`;
  });

  if (linesLimit !== null && allLines.length > linesLimit) {
    formatted.push(`... （超长省略后续 ${allLines.length - linesLimit} 行）`);
  }

  return { content: formatted.join("\n"), linesLimit, columnsLimit };
}
