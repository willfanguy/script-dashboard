import type { RunRecord, ScriptRegistry } from "@/types";

interface ChronoFilterChipsProps {
  runs: RunRecord[];
  registry: ScriptRegistry | null;
  // Set of category keys that are currently HIDDEN. Storing disabled rather
  // than enabled lets the default state (empty Set) mean "all on" — no
  // migration needed when new categories appear in the registry.
  disabled: Set<string>;
  onToggle: (category: string) => void;
}

export function ChronoFilterChips({
  runs,
  registry,
  disabled,
  onToggle,
}: ChronoFilterChipsProps) {
  const counts = new Map<string, number>();
  for (const r of runs) {
    counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  }

  // Registry order first, then any categories present in data but unknown
  // to the registry — same convention as groupByCategory.
  const registryOrder = registry ? Object.keys(registry.categories) : [];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const cat of registryOrder) {
    if (counts.has(cat)) {
      ordered.push(cat);
      seen.add(cat);
    }
  }
  for (const cat of counts.keys()) {
    if (!seen.has(cat)) ordered.push(cat);
  }

  if (ordered.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 pb-3">
      {ordered.map((cat) => {
        const enabled = !disabled.has(cat);
        const label = registry?.categories[cat]?.label || cat;
        const count = counts.get(cat) ?? 0;
        return (
          <button
            key={cat}
            type="button"
            onClick={() => onToggle(cat)}
            aria-pressed={enabled}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border transition-colors ${
              enabled
                ? "bg-primary/10 border-primary/30 text-foreground hover:bg-primary/15"
                : "bg-transparent border-border text-muted-foreground hover:bg-muted/50 line-through decoration-1"
            }`}
          >
            <span className="font-medium">{label}</span>
            <span className="text-muted-foreground tabular-nums">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
