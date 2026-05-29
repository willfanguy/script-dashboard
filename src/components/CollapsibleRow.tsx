import type { ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CollapsibleRowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Extra classes on the Card (e.g. status borders, background tint). */
  cardClassName?: string;
  /** Extra classes on the inner trigger row (padding, hover color). */
  triggerClassName?: string;
  /** Leading glyph(s) shown before the header (status / category icons). */
  leading?: ReactNode;
  /** Main header content; rendered in a flex-1 min-w-0 column. */
  header: ReactNode;
  /** Right-aligned metadata shown before the chevron (duration, timestamp). */
  trailing?: ReactNode;
  /** Expanded body. */
  children: ReactNode;
}

// Shared expand/collapse card scaffold for the run list: a Card wrapping a
// trigger row (leading glyphs · header · trailing meta · rotating chevron) and
// a collapsible body. Both RunCard and RunClusterCard render through this so the
// chrome stays consistent and a third card type is cheap.
export function CollapsibleRow({
  open,
  onOpenChange,
  cardClassName,
  triggerClassName,
  leading,
  header,
  trailing,
  children,
}: CollapsibleRowProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <Card className={cn("p-0 overflow-hidden", cardClassName)}>
        <CollapsibleTrigger className="w-full cursor-pointer">
          <div
            className={cn(
              "flex items-center gap-3 transition-colors",
              triggerClassName,
            )}
          >
            {leading}
            <div className="flex-1 text-left min-w-0">{header}</div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
              {trailing}
              <ChevronRight
                className={cn(
                  "h-4 w-4 transition-transform",
                  open && "rotate-90",
                )}
              />
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>{children}</CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
