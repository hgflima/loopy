/** UI primitives — the app's shared component vocabulary (DESIGN.md §5). */
export { Button, type ButtonVariant } from "./Button";
export {
  StatusDot,
  TaskStatusDot,
  Pill,
  TaskStatusPill,
  TASK_STATUS_META,
  type Tone,
} from "./StatusIndicator";
export { SegmentedControl, type Segment } from "./SegmentedControl";
export { Menu, MenuItem, MenuSeparator } from "./Menu";
export { MarkdownStream, type MarkdownStreamProps } from "./MarkdownStream";
export { ToolCallCard, type ToolCallCardProps } from "./ToolCallCard";
export { DiffView, type DiffViewProps } from "./DiffView";
export { StepDivider } from "./StepDivider";
export { IconOpen, IconStop, IconInfo, IconPower } from "./icons";
export { usePrefersReducedMotion } from "./usePrefersReducedMotion";
