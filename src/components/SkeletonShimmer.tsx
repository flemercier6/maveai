import { cn } from "@/lib/utils";

type Props = React.HTMLAttributes<HTMLDivElement>;

/**
 * Reusable skeleton placeholder with a shimmer effect.
 * Uses the existing `title-shimmer` keyframes (animated background-position).
 */
export function SkeletonShimmer({ className, ...props }: Props) {
  return (
    <div
      {...props}
      className={cn(
        "rounded-md bg-gradient-to-r from-muted via-border to-muted bg-[length:200%_100%] animate-title-shimmer",
        className,
      )}
    />
  );
}
