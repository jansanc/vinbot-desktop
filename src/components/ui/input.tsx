import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

// The web app's field (IndInput): 8px corners, a 3:1 border, an indigo ring.
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "h-10 w-full min-w-0 rounded-lg border border-input/75 bg-card px-3 text-sm text-foreground shadow-(--shadow-2xs) transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/70 hover:border-input focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/25 aria-invalid:border-destructive/70 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
)
Input.displayName = "Input"

export { Input }
