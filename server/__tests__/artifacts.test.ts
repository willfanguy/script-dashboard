import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  appendNote,
  archiveArtifact,
  ArtifactError,
  loadArtifactsConfig,
  patchArtifact,
  readArtifact,
  resolveSafePath,
} from "../artifacts.js";

let workdir: string;
let tasksDir: string;
let archiveDir: string;

beforeEach(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), "sd-artifacts-"));
  tasksDir = path.join(workdir, "Tasks");
  archiveDir = path.join(workdir, "Archive");
  fs.mkdirSync(tasksDir);
  fs.mkdirSync(archiveDir);
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

function writeFixture(filename: string, body: string): string {
  const p = path.join(tasksDir, filename);
  fs.writeFileSync(p, body);
  return p;
}

function cfg() {
  return {
    artifactRoots: [{ root: tasksDir, archive: archiveDir }],
  };
}

const SAMPLE_TASK = `---
title: Test task
status: open
priority: 3-medium
projects:
  - "[[SuperFit]]"
tags:
  - task
---

## Description

Body content.

## Notes

`;

describe("loadArtifactsConfig", () => {
  it("returns empty roots when config file is missing", () => {
    const result = loadArtifactsConfig(path.join(workdir, "nope.json"));
    expect(result).toEqual({ artifactRoots: [] });
  });

  it("returns empty roots when config file has invalid JSON", () => {
    const p = path.join(workdir, "bad.json");
    fs.writeFileSync(p, "{not json");
    expect(loadArtifactsConfig(p)).toEqual({ artifactRoots: [] });
  });

  it("parses valid config with multiple roots", () => {
    const p = path.join(workdir, "good.json");
    fs.writeFileSync(
      p,
      JSON.stringify({
        artifactRoots: [
          { root: "/vault/Tasks", archive: "/vault/Archive" },
          { root: "/other", archive: "/other-archive" },
        ],
      }),
    );
    const result = loadArtifactsConfig(p);
    expect(result.artifactRoots).toHaveLength(2);
    expect(result.artifactRoots[0].root).toBe("/vault/Tasks");
  });

  it("skips malformed entries but keeps good ones", () => {
    const p = path.join(workdir, "mixed.json");
    fs.writeFileSync(
      p,
      JSON.stringify({
        artifactRoots: [
          { root: "/vault/Tasks", archive: "/vault/Archive" },
          "not an object",
          { root: 42 },
          { archive: "only-archive" },
        ],
      }),
    );
    const result = loadArtifactsConfig(p);
    expect(result.artifactRoots).toHaveLength(1);
  });
});

describe("resolveSafePath", () => {
  it("throws 503 when no roots configured", () => {
    const err = captureError(() =>
      resolveSafePath("/anywhere", { artifactRoots: [] }),
    );
    expect(err).toBeInstanceOf(ArtifactError);
    expect((err as ArtifactError).status).toBe(503);
  });

  it("throws 400 when path is empty", () => {
    const err = captureError(() => resolveSafePath("", cfg()));
    expect((err as ArtifactError).status).toBe(400);
  });

  it("accepts a path inside the configured root", () => {
    const target = writeFixture("a.md", "hi");
    const result = resolveSafePath(target, cfg());
    expect(result.absPath).toBe(fs.realpathSync(target));
    expect(result.root.root).toBe(tasksDir);
  });

  it("rejects a path traversal attempt (..)", () => {
    const traversal = path.join(tasksDir, "..", "..", "etc", "passwd");
    const err = captureError(() => resolveSafePath(traversal, cfg()));
    expect((err as ArtifactError).status).toBe(400);
  });

  it("rejects a sibling directory that shares a prefix", () => {
    // "Tasks-Archive" starts with "Tasks" — shouldn't resolve against
    // "Tasks" root unless it's actually inside it.
    const sibling = path.join(workdir, "Tasks-Archive");
    fs.mkdirSync(sibling);
    const targetInSibling = path.join(sibling, "leak.md");
    fs.writeFileSync(targetInSibling, "oops");
    const err = captureError(() => resolveSafePath(targetInSibling, cfg()));
    expect((err as ArtifactError).status).toBe(400);
  });

  it("rejects a symlink that escapes the root", () => {
    const outside = path.join(workdir, "outside.md");
    fs.writeFileSync(outside, "escaped");
    const symlinkInside = path.join(tasksDir, "looks-safe.md");
    fs.symlinkSync(outside, symlinkInside);
    const err = captureError(() => resolveSafePath(symlinkInside, cfg()));
    expect((err as ArtifactError).status).toBe(400);
  });

  it("accepts paths in any configured root", () => {
    const other = path.join(workdir, "Other");
    const otherArchive = path.join(workdir, "Other-Archive");
    fs.mkdirSync(other);
    fs.mkdirSync(otherArchive);
    const f = path.join(other, "hello.md");
    fs.writeFileSync(f, "hi");
    const config = {
      artifactRoots: [
        { root: tasksDir, archive: archiveDir },
        { root: other, archive: otherArchive },
      ],
    };
    const result = resolveSafePath(f, config);
    expect(result.root.root).toBe(other);
  });
});

describe("readArtifact", () => {
  it("returns parsed frontmatter and body", () => {
    const p = writeFixture("task.md", SAMPLE_TASK);
    const result = readArtifact(p);
    expect(result.frontmatter.status).toBe("open");
    expect(result.frontmatter.priority).toBe("3-medium");
    expect(result.body).toContain("## Description");
    expect(result.body).toContain("## Notes");
  });

  it("handles a file with no frontmatter", () => {
    const p = writeFixture("bare.md", "just a body\n");
    const result = readArtifact(p);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("just a body\n");
  });

  it("throws 404 when file does not exist", () => {
    const err = captureError(() =>
      readArtifact(path.join(tasksDir, "missing.md")),
    );
    expect((err as ArtifactError).status).toBe(404);
  });
});

describe("patchArtifact", () => {
  it("updates status and preserves other frontmatter", () => {
    const p = writeFixture("t.md", SAMPLE_TASK);
    const result = patchArtifact(p, { status: "done" });
    expect(result.frontmatter.status).toBe("done");
    expect(result.frontmatter.priority).toBe("3-medium");
    expect(result.frontmatter.title).toBe("Test task");
    // Verify persisted on disk
    const reread = readArtifact(p);
    expect(reread.frontmatter.status).toBe("done");
  });

  it("updates priority", () => {
    const p = writeFixture("t.md", SAMPLE_TASK);
    patchArtifact(p, { priority: "1-urgent" });
    const reread = readArtifact(p);
    expect(reread.frontmatter.priority).toBe("1-urgent");
  });

  it("rejects non-string status", () => {
    const p = writeFixture("t.md", SAMPLE_TASK);
    const err = captureError(() =>
      patchArtifact(p, { status: 5 as unknown as string }),
    );
    expect((err as ArtifactError).status).toBe(400);
  });

  it("appends a note into the existing Notes section", () => {
    const p = writeFixture("t.md", SAMPLE_TASK);
    patchArtifact(p, { appendNote: "2026-04-21: checked in" });
    const content = fs.readFileSync(p, "utf-8");
    expect(content).toContain("- 2026-04-21: checked in");
    expect(content).toMatch(/## Notes\s*\n\s*\n\s*- 2026-04-21: checked in/);
  });

  it("ignores empty appendNote", () => {
    const p = writeFixture("t.md", SAMPLE_TASK);
    const before = fs.readFileSync(p, "utf-8");
    patchArtifact(p, { appendNote: "   " });
    const after = fs.readFileSync(p, "utf-8");
    // Body content is unchanged
    expect(after).not.toMatch(/- \s*$/m);
    // gray-matter may re-serialize whitespace; just confirm no bullet added
    expect(after).toContain(before.split("---\n\n")[1]?.split("## Notes")[0] ?? "");
  });

  it("appends to file with no Notes section by creating one", () => {
    const p = writeFixture(
      "nonotes.md",
      "---\nstatus: open\n---\n\nSome body.\n",
    );
    patchArtifact(p, { appendNote: "first note" });
    const content = fs.readFileSync(p, "utf-8");
    expect(content).toContain("## Notes");
    expect(content).toContain("- first note");
  });

  it("preserves YYYY-MM-DD date strings without converting to ISO timestamps", () => {
    // Regression guard: default js-yaml schema parses ISO-like dates as
    // JS Date objects and re-serializes them as "2026-04-21T00:00:00.000Z",
    // which silently breaks Obsidian Dataview queries expecting YYYY-MM-DD.
    const p = writeFixture(
      "dated.md",
      "---\nstatus: open\ndateCreated: 2026-04-21\ndue: 2026-05-01\n---\n\nBody.\n",
    );
    patchArtifact(p, { status: "done" });
    const content = fs.readFileSync(p, "utf-8");
    expect(content).toContain("dateCreated: 2026-04-21");
    expect(content).toContain("due: 2026-05-01");
    expect(content).not.toContain("T00:00:00");
  });

  it("stacks multiple appended notes with newest first", () => {
    const p = writeFixture("t.md", SAMPLE_TASK);
    patchArtifact(p, { appendNote: "older note" });
    patchArtifact(p, { appendNote: "newer note" });
    const content = fs.readFileSync(p, "utf-8");
    const newerIdx = content.indexOf("newer note");
    const olderIdx = content.indexOf("older note");
    expect(newerIdx).toBeGreaterThan(-1);
    expect(olderIdx).toBeGreaterThan(-1);
    expect(newerIdx).toBeLessThan(olderIdx);
  });
});

describe("appendNote helper", () => {
  it("inserts at top of existing Notes section, keeping list tight", () => {
    const body = "## Description\n\nStuff.\n\n## Notes\n\n- old note\n";
    const result = appendNote(body, "new note");
    expect(result).toContain("- new note\n- old note");
  });

  it("inserts into an empty Notes section with blank lines around it", () => {
    // This is the real-world slack-saved-sync shape: empty Notes followed
    // by another heading. The bullet needs blank lines on both sides so
    // the trailing section isn't visually glued onto the note.
    const body = "## Notes\n\n## Links\n";
    const result = appendNote(body, "hello");
    expect(result).toBe("## Notes\n\n- hello\n\n## Links\n");
  });

  it("preserves existing content after Notes section when inserting", () => {
    const body = "## Notes\n\n- old\n\n## Links\n- link\n";
    const result = appendNote(body, "new");
    expect(result).toContain("- new\n- old");
    expect(result).toContain("## Links\n- link");
  });

  it("creates a Notes section when missing", () => {
    const body = "## Description\n\nStuff.\n";
    const result = appendNote(body, "hello");
    expect(result).toMatch(/## Description[\s\S]*## Notes\s*\n\s*\n- hello/);
  });

  it("handles empty body", () => {
    const result = appendNote("", "first");
    expect(result).toBe("## Notes\n\n- first\n");
  });
});

describe("archiveArtifact", () => {
  it("moves the file into the archive dir", () => {
    const p = writeFixture("move-me.md", "contents");
    const root = { root: tasksDir, archive: archiveDir };
    const result = archiveArtifact(p, root);
    expect(fs.existsSync(p)).toBe(false);
    expect(fs.existsSync(result.newPath)).toBe(true);
    expect(result.newPath).toBe(path.join(archiveDir, "move-me.md"));
  });

  it("creates the archive dir if missing", () => {
    const emptyArchive = path.join(workdir, "NewArchive");
    expect(fs.existsSync(emptyArchive)).toBe(false);
    const p = writeFixture("m.md", "x");
    archiveArtifact(p, { root: tasksDir, archive: emptyArchive });
    expect(fs.existsSync(emptyArchive)).toBe(true);
  });

  it("disambiguates when target exists", () => {
    // Pre-seed the archive with a same-named file
    fs.writeFileSync(path.join(archiveDir, "collide.md"), "already here");
    const p = writeFixture("collide.md", "fresh");
    const root = { root: tasksDir, archive: archiveDir };
    const result = archiveArtifact(p, root);
    expect(result.newPath).not.toBe(path.join(archiveDir, "collide.md"));
    expect(result.newPath).toMatch(/collide \(.*\)\.md$/);
    expect(fs.existsSync(result.newPath)).toBe(true);
    // Original archive file untouched
    expect(
      fs.readFileSync(path.join(archiveDir, "collide.md"), "utf-8"),
    ).toBe("already here");
  });

  it("throws 404 when source file missing", () => {
    const err = captureError(() =>
      archiveArtifact(path.join(tasksDir, "nope.md"), {
        root: tasksDir,
        archive: archiveDir,
      }),
    );
    expect((err as ArtifactError).status).toBe(404);
  });
});

function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}
