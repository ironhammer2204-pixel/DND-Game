/* eslint-disable react-refresh/only-export-components */
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--game-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--obsidian)] disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-[var(--runic-gold)] text-[var(--obsidian)] hover:bg-[var(--runic-gold)]/90",
        destructive: "bg-[var(--deep-crimson)] text-[var(--parchment)] hover:bg-[var(--deep-crimson)]/90",
        outline: "border border-[var(--game-border)] bg-transparent text-[var(--parchment)] hover:bg-[var(--game-muted)] hover:text-[var(--parchment)]",
        secondary: "bg-[var(--game-muted)] text-[var(--parchment)] hover:bg-[var(--game-muted)]/80",
        ghost: "text-[var(--muted-text)] hover:bg-[var(--game-muted)] hover:text-[var(--parchment)]",
        link: "text-[var(--runic-gold)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-12 rounded-md px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
