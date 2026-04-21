import fs from "fs";
import path from "path";
import os from "os";
import matter from "gray-matter";
import yaml from "js-yaml";

// Force a YAML schema that does NOT auto-parse ISO-like date strings into
// Date objects. The default js-yaml schema converts "2026-04-21" to a JS
// Date, which then re-serializes as "2026-04-21T00:00:00.000Z" — that would
// silently break Obsidian Dataview queries that match on `YYYY-MM-DD`.
// JSON_SCHEMA omits the !!timestamp type, so dates stay as plain strings.
const YAML_ENGINE = {
  parse: (input: string) => {
    const parsed = yaml.load(input, { schema: yaml.JSON_SCHEMA });
    return parsed && typeof parsed === "object" ? (parsed as object) : {};
  },
  stringify: (data: object) =>
    yaml.dump(data, { schema: yaml.JSON_SCHEMA, lineWidth: -1 }),
};

export interface ArtifactRoot {
  root: string;   // absolute path; artifact reads/writes must stay inside
  archive: string; // absolute path; archive target for files under root
}

export interface ArtifactsConfig {
  artifactRoots: ArtifactRoot[];
}

export interface ArtifactDetail {
  path: string; // absolute path on disk
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface ArtifactPatchInput {
  status?: string;
  priority?: string;
  appendNote?: string;
}

const DEFAULT_CONFIG_PATH = path.join(
  os.homedir(),
  ".config",
  "script-dashboard",
  "server-config.json",
);

export function loadArtifactsConfig(
  configPath = process.env.SCRIPT_DASH_SERVER_CONFIG || DEFAULT_CONFIG_PATH,
): ArtifactsConfig {
  if (!fs.existsSync(configPath)) return { artifactRoots: [] };

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch {
    return { artifactRoots: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { artifactRoots: [] };
  }

  if (!parsed || typeof parsed !== "object") return { artifactRoots: [] };
  const maybeRoots = (parsed as { artifactRoots?: unknown }).artifactRoots;
  if (!Array.isArray(maybeRoots)) return { artifactRoots: [] };

  const artifactRoots: ArtifactRoot[] = [];
  for (const entry of maybeRoots) {
    if (!entry || typeof entry !== "object") continue;
    const { root, archive } = entry as { root?: unknown; archive?: unknown };
    if (typeof root !== "string" || typeof archive !== "string") continue;
    artifactRoots.push({
      root: path.resolve(root),
      archive: path.resolve(archive),
    });
  }
  return { artifactRoots };
}

// Throw if target is not contained within one of the configured roots.
// Returns the matching root so callers can derive the archive target.
export function resolveSafePath(
  inputPath: string,
  config: ArtifactsConfig,
): { absPath: string; root: ArtifactRoot } {
  if (!config.artifactRoots.length) {
    throw new ArtifactError(
      503,
      "Artifact access is not configured on this server.",
    );
  }

  if (typeof inputPath !== "string" || inputPath.length === 0) {
    throw new ArtifactError(400, "path query parameter is required");
  }

  const absPath = path.resolve(inputPath);

  // resolve() is enough to collapse ".." BEFORE we check containment,
  // but we also need to resolve symlinks if the file exists.
  let realPath = absPath;
  if (fs.existsSync(absPath)) {
    realPath = fs.realpathSync(absPath);
  }

  for (const root of config.artifactRoots) {
    const rootReal = fs.existsSync(root.root)
      ? fs.realpathSync(root.root)
      : root.root;
    // Require EXACT containment — rootReal + separator + anything.
    // Comparing against rootReal + path.sep prevents partial-prefix matches
    // (e.g., "/vault/Tasks-Archive" wouldn't match root "/vault/Tasks").
    if (
      realPath === rootReal ||
      realPath.startsWith(rootReal + path.sep)
    ) {
      return { absPath: realPath, root };
    }
  }

  throw new ArtifactError(
    400,
    "path is outside of allowed artifact roots",
  );
}

export class ArtifactError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function readArtifact(
  absPath: string,
): ArtifactDetail {
  if (!fs.existsSync(absPath)) {
    throw new ArtifactError(404, "artifact not found");
  }
  const raw = fs.readFileSync(absPath, "utf-8");
  const parsed = matter(raw, { engines: { yaml: YAML_ENGINE } });
  return {
    path: absPath,
    frontmatter: { ...parsed.data },
    body: parsed.content,
  };
}

// Apply a restricted patch: status, priority, appendNote.
// Merges into existing frontmatter; body is rewritten with the same
// frontmatter serializer so the file round-trips cleanly.
export function patchArtifact(
  absPath: string,
  patch: ArtifactPatchInput,
): ArtifactDetail {
  const current = readArtifact(absPath);

  const nextFrontmatter: Record<string, unknown> = { ...current.frontmatter };
  if (patch.status !== undefined) {
    if (typeof patch.status !== "string") {
      throw new ArtifactError(400, "status must be a string");
    }
    nextFrontmatter.status = patch.status;
  }
  if (patch.priority !== undefined) {
    if (typeof patch.priority !== "string") {
      throw new ArtifactError(400, "priority must be a string");
    }
    nextFrontmatter.priority = patch.priority;
  }

  let nextBody = current.body;
  if (patch.appendNote !== undefined) {
    if (typeof patch.appendNote !== "string") {
      throw new ArtifactError(400, "appendNote must be a string");
    }
    const trimmed = patch.appendNote.trim();
    if (trimmed.length > 0) {
      nextBody = appendNote(nextBody, trimmed);
    }
  }

  const serialized = matter.stringify(nextBody, nextFrontmatter, {
    engines: { yaml: YAML_ENGINE },
  });
  atomicWrite(absPath, serialized);

  return {
    path: absPath,
    frontmatter: nextFrontmatter,
    body: nextBody,
  };
}

// Insert a new bullet at the top of the `## Notes` section. If the section
// doesn't exist, append one at the end of the body.
//
// Spacing rules:
//   - If the Notes section has existing bullets, the new one slides in as the
//     first bullet, keeping the list tight.
//   - If the Notes section is empty, we insert the bullet between a blank line
//     above and a blank line below, so the next heading remains separated.
export function appendNote(body: string, note: string): string {
  const bullet = `- ${note}`;
  const lines = body.split("\n");

  const notesIdx = lines.findIndex((l) => /^## Notes[ \t]*$/.test(l));
  if (notesIdx === -1) {
    const trimmed = body.replace(/\s+$/, "");
    const prefix = trimmed.length > 0 ? trimmed + "\n\n" : "";
    return `${prefix}## Notes\n\n${bullet}\n`;
  }

  // End of Notes section = next `## ` heading line, or EOF.
  let sectionEndIdx = lines.length;
  for (let i = notesIdx + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      sectionEndIdx = i;
      break;
    }
  }

  const sectionContent = lines.slice(notesIdx + 1, sectionEndIdx);
  const firstNonEmptyOffset = sectionContent.findIndex((l) => l.trim() !== "");

  if (firstNonEmptyOffset !== -1) {
    // Insert new bullet as the first content line of the section.
    const insertAt = notesIdx + 1 + firstNonEmptyOffset;
    return [
      ...lines.slice(0, insertAt),
      bullet,
      ...lines.slice(insertAt),
    ].join("\n");
  }

  // Empty Notes section — replace the empty span with a blank + bullet + blank,
  // preserving whatever follows (the next heading, or EOF).
  return [
    ...lines.slice(0, notesIdx + 1),
    "",
    bullet,
    "",
    ...lines.slice(sectionEndIdx),
  ].join("\n");
}

export interface ArchiveResult {
  originalPath: string;
  newPath: string;
}

export function archiveArtifact(
  absPath: string,
  root: ArtifactRoot,
): ArchiveResult {
  if (!fs.existsSync(absPath)) {
    throw new ArtifactError(404, "artifact not found");
  }

  if (!fs.existsSync(root.archive)) {
    fs.mkdirSync(root.archive, { recursive: true });
  }

  const filename = path.basename(absPath);
  let target = path.join(root.archive, filename);
  if (fs.existsSync(target)) {
    // Disambiguate with a timestamp before the extension.
    const ext = path.extname(filename);
    const stem = filename.slice(0, filename.length - ext.length);
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace(/Z$/, "");
    target = path.join(root.archive, `${stem} (${stamp})${ext}`);
  }

  fs.renameSync(absPath, target);

  return {
    originalPath: absPath,
    newPath: target,
  };
}

function atomicWrite(target: string, contents: string): void {
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, contents, "utf-8");
  fs.renameSync(tmp, target);
}
