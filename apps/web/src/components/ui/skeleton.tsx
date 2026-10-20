import { cn } from "@/lib/utils"

/** A placeholder with a soft light sweeping across it. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "relative overflow-hidden rounded-md bg-accent",
        "after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_1.9s_ease-in-out_infinite] after:bg-gradient-to-r after:from-transparent after:via-foreground/[0.07] after:to-transparent",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
