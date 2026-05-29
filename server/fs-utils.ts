import fs from "fs";
import path from "path";

// Write JSON to `file` atomically: serialize to a sibling temp file, then
// rename over the destination. rename(2) is atomic within a filesystem, so a
// concurrent reader sees either the old file or the fully-written new one,
// never a partial write. Used for every run record / registry the dashboard
// owns (the shell side mirrors this with python's os.replace).
export function atomicWriteJson(file: string, value: unknown): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}
