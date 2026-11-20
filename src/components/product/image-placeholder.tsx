import {
  Cpu,
  Gamepad2,
  Headphones,
  Laptop,
  type LucideIcon,
  Microchip,
  Monitor,
  Package,
  Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Lucide icon names stored in categories.icon -> components. Unknown names fall back to a box. */
const ICONS: Record<string, LucideIcon> = {
  smartphone: Smartphone,
  laptop: Laptop,
  "gamepad-2": Gamepad2,
  cpu: Cpu,
  microchip: Microchip,
  monitor: Monitor,
  headphones: Headphones,
};

export function CategoryIcon({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  const Icon = (name && ICONS[name]) || Package;
  return <Icon aria-hidden="true" strokeWidth={1.5} className={className} />;
}

/**
 * Shown for products without a licensed image (most products at launch): a quiet, uniform
 * neutral surface with crossed hairlines, the category glyph and an honest label.
 */
export function ImagePlaceholder({
  icon,
  label = "Image pending licence",
  className,
  iconClassName = "size-11",
  children,
}: {
  icon: string | null | undefined;
  label?: string;
  className?: string;
  iconClassName?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="img"
      aria-label={`No product image: ${label.toLowerCase()}`}
      className={cn(
        "image-placeholder relative flex flex-col items-center justify-center gap-2 text-muted-foreground",
        className,
      )}
    >
      {children}
      <span className="bg-muted p-1">
        <CategoryIcon name={icon} className={iconClassName} />
      </span>
      <span className="bg-muted px-1.5 text-[10px] tracking-[0.1em] uppercase">{label}</span>
    </div>
  );
}
