import {
  Clock,
  Video,
  Hand,
  Zap,
  MessageCircle,
  FlaskConical,
  HelpCircle,
} from "lucide-react";

// Render a small muted glyph for a registry category, shown to the left of the
// row's status icon — pre-filters the eye by category without competing with
// the (louder) status badge. Keys mirror lib/scripts.json category
// definitions; unknown categories fall back to HelpCircle.
//
// Implemented as a component that returns static JSX rather than selecting a
// component at runtime and rendering it (`const Icon = pick(); <Icon />`). That
// dynamic-component pattern is flagged by react-hooks/static-components because
// the runtime-chosen identity resets child state on every render.
export function CategoryGlyph({
  category,
  className,
}: {
  category: string;
  className?: string;
}) {
  const props = { className, "aria-label": category };
  switch (category) {
    case "scheduled":
      return <Clock {...props} />;
    case "meeting":
      return <Video {...props} />;
    case "manual":
      return <Hand {...props} />;
    case "skill":
      return <Zap {...props} />;
    case "interactive":
      return <MessageCircle {...props} />;
    case "eval":
      return <FlaskConical {...props} />;
    default:
      return <HelpCircle {...props} />;
  }
}
