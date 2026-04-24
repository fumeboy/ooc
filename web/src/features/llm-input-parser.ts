export interface MessageBlock {
  role: "system" | "user" | "other";
  rawXml: string;
}

function collectXmlProtectedRanges(raw: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const rx = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(raw)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

function isInRanges(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function findRoleBlockEnd(
  raw: string,
  role: "system" | "user" | "assistant",
  start: number,
  protectedRanges: Array<[number, number]>,
): number {
  const tagRx = new RegExp(`<(/?)${role}(?:\\s[^>]*)?>`, "g");
  tagRx.lastIndex = start;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRx.exec(raw)) !== null) {
    if (isInRanges(m.index, protectedRanges)) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

export function splitMessageBlocks(raw: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const rx = /^--- (\w+) ---\n/gm;
  const matches: { role: string; start: number; contentStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(raw)) !== null) {
    matches.push({ role: m[1]!, start: m.index, contentStart: m.index + m[0].length });
  }
  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const cur = matches[i]!;
      const next = matches[i + 1];
      const end = next ? next.start : raw.length;
      const body = raw.slice(cur.contentStart, end).trim();
      const role = (cur.role === "system" || cur.role === "user") ? cur.role : "other";
      blocks.push({ role, rawXml: body });
    }
    return blocks;
  }

  const protectedRanges = collectXmlProtectedRanges(raw);
  const roleRx = /<(system|user|assistant)(?:\s[^>]*)?>/g;
  let rm: RegExpExecArray | null;
  let foundRoleBlock = false;
  while ((rm = roleRx.exec(raw)) !== null) {
    if (isInRanges(rm.index, protectedRanges)) continue;
    foundRoleBlock = true;
    const matchedRole = rm[1] as "system" | "user" | "assistant";
    const end = findRoleBlockEnd(raw, matchedRole, rm.index, protectedRanges);
    const bodyEnd = end >= 0 ? end : raw.length;
    const body = raw.slice(rm.index, bodyEnd).trim();
    const role = (matchedRole === "system" || matchedRole === "user") ? matchedRole : "other";
    blocks.push({ role, rawXml: body });
    roleRx.lastIndex = bodyEnd;
  }
  if (foundRoleBlock) {
    return blocks;
  }

  blocks.push({ role: "other", rawXml: raw });
  return blocks;
}
