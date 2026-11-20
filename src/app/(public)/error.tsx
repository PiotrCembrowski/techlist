"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col items-start gap-5 px-4 py-24 sm:px-6 lg:px-10">
      <span className="label-caps">Something went wrong</span>
      <h1 className="text-4xl">This page could not be loaded</h1>
      <p className="max-w-[560px] text-muted-foreground">
        An unexpected error occurred. It has been logged.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
