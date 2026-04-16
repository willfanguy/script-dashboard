import type { RunRecord, ScriptRegistry } from "@/types";

export function groupByCategory(
  runs: RunRecord[],
  registry: ScriptRegistry | null
): Map<string, RunRecord[]> {
  const groups = new Map<string, RunRecord[]>();

  // Use registry order for categories if available
  const categoryOrder = registry
    ? Object.keys(registry.categories)
    : [];

  for (const run of runs) {
    const cat = run.category || "other";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(run);
  }

  // Sort by registry order, then alphabetical for unknown categories
  const sorted = new Map<string, RunRecord[]>();
  for (const cat of categoryOrder) {
    if (groups.has(cat)) {
      sorted.set(cat, groups.get(cat)!);
      groups.delete(cat);
    }
  }
  for (const [cat, catRuns] of groups) {
    sorted.set(cat, catRuns);
  }

  return sorted;
}
