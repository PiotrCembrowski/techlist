"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="secondary"
      size="icon"
      className="size-11 sm:size-9"
      aria-label="Switch between light and dark theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {/* Both icons render; CSS picks one, so server and client markup always match. */}
      <Sun strokeWidth={1.5} className="hidden dark:block" />
      <Moon strokeWidth={1.5} className="block dark:hidden" />
    </Button>
  );
}
