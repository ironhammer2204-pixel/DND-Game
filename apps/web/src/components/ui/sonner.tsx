import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-[var(--elevated)] group-[.toaster]:text-[var(--parchment)] group-[.toaster]:border-[var(--game-border)] group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-[var(--muted-text)]",
          actionButton:
            "group-[.toast]:bg-[var(--runic-gold)] group-[.toast]:text-[var(--obsidian)]",
          cancelButton:
            "group-[.toast]:bg-[var(--game-muted)] group-[.toast]:text-[var(--parchment)]",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
