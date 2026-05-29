// Map a cmux workspace name to a Tailwind className string applied to the
// workspace chip's Badge. Returns "" when the workspace isn't in the map,
// which lets the Badge fall back to the default outline variant.
//
// Matching is case-insensitive. To add a workspace, extend COLOR_MAP with
// a new entry — keep the keys lowercase.

const COLOR_MAP: Record<string, string> = {
  personal:
    "border-orange-400 text-orange-700 bg-orange-50 hover:bg-orange-100 dark:border-orange-500/60 dark:text-orange-300 dark:bg-orange-950/40",
  work:
    "border-green-500 text-green-700 bg-green-50 hover:bg-green-100 dark:border-green-500/60 dark:text-green-300 dark:bg-green-950/40",
};

export function workspaceColor(name: string | null | undefined): string {
  if (!name) return "";
  return COLOR_MAP[name.toLowerCase()] ?? "";
}
