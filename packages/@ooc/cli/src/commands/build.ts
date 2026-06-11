import { mkdir, readdir, stat, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

/**
 * ooc build — precompile stones for production.
 *
 *   1. Compile each stone's `executable/index.ts` (or legacy `server/index.ts`) to a plain
 *      JS module under `.ooc-dist/stones/<id>/executable/index.js` so the runtime can
 *      load it without bun transpilation overhead.
 *   2. Copy static identity files (self.md, readable.md, readable.ts, package.json,
 *      knowledge/**) into `.ooc-dist/stones/<id>/` so the production runtime only needs
 *      to read from `.ooc-dist/` and never touches the source tree.
 *   3. Produce `.ooc-dist/stones/index.json` — a deterministic registry consumed by
 *      `ooc start` to skip filesystem scanning.
 *
 * Not yet implemented in M4:
 *   - Visible (React) bundling per stone. The frontend still relies on Vite HMR in dev
 *     and will need a per-stone Rollup pass for production; tracked as a follow-up.
 *   - `@ooc/web` SPA bundle copying (depends on the above).
 */

const BUILD_DIRNAME = ".ooc-dist";

function hasFlag(argv: string[], names: string[]): boolean {
  return argv.some((a) => names.includes(a));
}

function readFlagValue(argv: string[], names: string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    for (const name of names) {
      if (arg === name) return argv[i + 1];
      const prefix = `${name}=`;
      if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    }
  }
  return undefined;
}

function printUsage(): void {
  console.log(`Usage: ooc build [options]

Precompile an OOC World for production use.
Output is written to .ooc-dist/ inside the world directory.

Options:
  --world <dir>   Path to the OOC world directory (default: $OOC_WORLD_DIR or $PWD)
  --out <dir>     Output directory (default: <world>/${BUILD_DIRNAME})
  --clean         Remove output directory before building
  -h, --help      Show this help`);
}

interface StoneManifestEntry {
  objectId: string;
  dir: string;          // path relative to world root, e.g. "stones/foo"
  hasExecutable: boolean;
  hasVisible: boolean;
  hasKnowledge: boolean;
}

function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return !rel.startsWith("..") && !isAbsolute(rel);
}

async function walkCollect(
  root: string,
  outDir: string,
  opts: { includePattern: RegExp; excludePattern?: RegExp },
): Promise<string[]> {
  const collected: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        if (!opts.includePattern.test(full)) continue;
        if (opts.excludePattern && opts.excludePattern.test(full)) continue;
        if (!isInside(root, full)) continue;
        collected.push(full);
      }
    }
  }
  await walk(root);
  return collected;
}

async function bunBuild(
  entry: string,
  outFile: string,
  worldDir: string,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(
      process.execPath,
      [
        "build",
        entry,
        "--outfile", outFile,
        "--target", "bun",
        "--format", "esm",
        "--sourcemap=linked",
        // Externalize every @ooc/* package and other workspace peers so stones
        // don't bundle Core.
        "--external", "@ooc/*",
        "--external", "elysia",
        "--external", "openai",
        "--external", "react",
        "--external", "react-dom",
      ],
      {
        cwd: worldDir,
        stdio: "inherit",
        env: process.env,
      },
    );
    proc.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`bun build exited with code ${code}`));
    });
    proc.on("error", reject);
  });
}

async function scanStoneDir(stoneDir: string): Promise<{
  executable?: string;   // absolute path to executable/index.ts or server/index.ts
  visibleDir?: string;   // absolute path to visible/ (or legacy client/)
  knowledgeDir?: string; // absolute path to knowledge/
  identityFiles: string[]; // self.md, readable.md, readable.ts, package.json
}> {
  let executable: string | undefined;
  for (const candidate of [join(stoneDir, "executable", "index.ts"), join(stoneDir, "server", "index.ts")]) {
    if (existsSync(candidate)) { executable = candidate; break; }
  }
  let visibleDir: string | undefined;
  for (const candidate of [join(stoneDir, "visible"), join(stoneDir, "client")]) {
    if (existsSync(candidate)) { visibleDir = candidate; break; }
  }
  const knowledgeDir = existsSync(join(stoneDir, "knowledge")) ? join(stoneDir, "knowledge") : undefined;
  const identityFiles: string[] = [];
  for (const name of ["self.md", "readable.md", "readable.ts", "package.json"]) {
    const p = join(stoneDir, name);
    if (existsSync(p)) identityFiles.push(p);
  }
  return { executable, visibleDir, knowledgeDir, identityFiles };
}

/**
 * Recursively find stone packages under <root>/stones/ and <root>/packages/
 * (deprecated fallback). A stone is any directory containing a package.json
 * with an ooc.objectId field, or (legacy) a .stone.json file.
 */
async function findStones(worldDir: string): Promise<Array<{ dir: string; objectId: string }>> {
  const out: Array<{ dir: string; objectId: string }> = [];
  const seen = new Set<string>();

  async function walk(dir: string, idSegments: string[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    // Is this directory itself a stone?
    if (idSegments.length > 0) {
      let objectId: string | undefined;
      const pkgPath = join(dir, "package.json");
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(await Bun.file(pkgPath).text());
          if (pkg?.ooc?.objectId) objectId = pkg.ooc.objectId;
        } catch { /* ignore malformed */ }
      }
      if (!objectId && existsSync(join(dir, ".stone.json"))) {
        try {
          const meta = JSON.parse(await Bun.file(join(dir, ".stone.json")).text());
          if (meta?.objectId) objectId = meta.objectId;
        } catch { /* ignore */ }
      }
      if (!objectId) objectId = idSegments.join("/");
      if (!seen.has(objectId)) {
        seen.add(objectId);
        out.push({ dir, objectId });
      }
    }
    // Descend: at the top level of stones/packages/, every dir is a candidate stone.
    // Within a stone, only children/ marker contains more stones.
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith(".")) continue;
      if (e.name.startsWith("@")) continue;
      if (e.name === "children") {
        // descend into children/<id> treating each as a nested stone
        const childrenDir = join(dir, "children");
        let childEntries;
        try {
          childEntries = await readdir(childrenDir, { withFileTypes: true });
        } catch { continue; }
        for (const ce of childEntries) {
          if (!ce.isDirectory() || ce.name.startsWith(".") || ce.name.startsWith("@")) continue;
          await walk(join(childrenDir, ce.name), [...idSegments, ce.name]);
        }
      } else if (idSegments.length === 0) {
        await walk(join(dir, e.name), [e.name]);
      }
    }
  }

  await walk(join(worldDir, "stones"), []);
  await walk(join(worldDir, "packages"), []);
  return out;
}

async function rmrf(path: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(path, { recursive: true, force: true });
}

export default async function build(argv: string[]): Promise<void> {
  if (hasFlag(argv, ["-h", "--help"])) {
    printUsage();
    return;
  }

  const explicitWorld = readFlagValue(argv, ["--world", "--world-dir", "--base-dir"]);
  const rawWorldDir = explicitWorld ?? process.env.OOC_WORLD_DIR ?? process.env.OOC_BASE_DIR ?? process.cwd();
  const absWorldDir = resolve(rawWorldDir);

  try {
    const s = await stat(absWorldDir);
    if (!s.isDirectory()) throw new Error(`not a directory: ${absWorldDir}`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`world directory does not exist: ${absWorldDir}. Run 'ooc init' first.`);
    }
    throw e;
  }

  const explicitOut = readFlagValue(argv, ["--out"]);
  const outDir = resolve(explicitOut ? explicitOut : join(absWorldDir, BUILD_DIRNAME));
  const clean = hasFlag(argv, ["--clean"]);

  if (clean) {
    console.log(`[ooc] clean: removing ${outDir}`);
    await rmrf(outDir);
  }
  await mkdir(outDir, { recursive: true });

  console.log(`[ooc] world=${absWorldDir}`);
  console.log(`[ooc] out=${outDir}`);

  const stones = await findStones(absWorldDir);
  if (stones.length === 0) {
    console.warn("[ooc] no stones found — check that stones/<id>/package.json contains ooc.objectId");
  }
  console.log(`[ooc] found ${stones.length} stone(s): ${stones.map((s) => s.objectId).join(", ")}`);

  const manifest: StoneManifestEntry[] = [];

  for (const stone of stones) {
    const { executable, visibleDir, knowledgeDir, identityFiles } = await scanStoneDir(stone.dir);
    const relStoneDir = relative(absWorldDir, stone.dir);
    const stoneOutDir = join(outDir, relStoneDir);
    await mkdir(stoneOutDir, { recursive: true });

    // Copy identity files as-is.
    for (const f of identityFiles) {
      const target = join(stoneOutDir, basename(f));
      await copyFile(f, target);
    }

    // Compile executable if present.
    let hasExecutable = false;
    if (executable) {
      hasExecutable = true;
      const ext = basename(executable).endsWith(".ts") ? "ts" : "ts";
      const outFile = join(stoneOutDir, "executable", `index.js`);
      await mkdir(dirname(outFile), { recursive: true });
      console.log(`[ooc]   compile ${stone.objectId}: executable/index.${ext} → executable/index.js`);
      await bunBuild(executable, outFile, absWorldDir);
    }

    // Copy knowledge directory tree if present.
    let hasKnowledge = false;
    if (knowledgeDir) {
      hasKnowledge = true;
      const files = await walkCollect(knowledgeDir, outDir, {
        includePattern: /\.md$|\.txt$|\.yaml$|\.yml$/,
      });
      for (const f of files) {
        const rel = relative(knowledgeDir, f);
        const target = join(stoneOutDir, "knowledge", rel);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(f, target);
      }
      console.log(`[ooc]   copy ${stone.objectId}: knowledge/ (${files.length} file(s))`);
    }

    // Visible/ — copy the tree as-is (Vite/rollup per-stone bundling is M5 follow-up).
    let hasVisible = false;
    if (visibleDir) {
      hasVisible = true;
      const files = await walkCollect(visibleDir, outDir, {
        includePattern: /\.tsx?$|\.css$|\.svg$|\.png$|\.jpg$|\.jpeg$|\.gif$/,
      });
      for (const f of files) {
        const rel = relative(visibleDir, f);
        const target = join(stoneOutDir, "visible", rel);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(f, target);
      }
      console.log(`[ooc]   copy ${stone.objectId}: visible/ (${files.length} file(s))`);
    }

    manifest.push({
      objectId: stone.objectId,
      dir: relStoneDir.split(sep).join("/"),
      hasExecutable,
      hasVisible,
      hasKnowledge,
    });
  }

  const manifestPath = join(outDir, "stones", "index.json");
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`[ooc] wrote ${relative(absWorldDir, manifestPath)} (${manifest.length} stone(s))`);
  console.log("[ooc] build complete. Run 'ooc start' to serve the production build.");
}
