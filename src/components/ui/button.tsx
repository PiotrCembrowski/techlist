import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * shadcn/ui Button, restyled for the Industry "Drafting Sheet" direction:
 * square corners, hairline outline, condensed label; primary is the one solid object.
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 border font-heading font-semibold whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground hover:border-primary-hover hover:bg-primary-hover active:bg-primary-active",
        secondary:
          "border-border bg-transparent text-foreground hover:bg-accent active:bg-foreground/15",
        ghost:
          "border-transparent bg-transparent text-primary hover:bg-primary/10 active:bg-primary/20",
        destructive:
          "border-destructive bg-destructive text-destructive-foreground hover:opacity-90",
        link: "border-transparent px-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3.5 text-sm",
        sm: "h-8 px-2.5 text-[13px]",
        lg: "h-11 px-5 text-[15px]",
        icon: "size-9 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
