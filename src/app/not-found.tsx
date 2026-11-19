import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col items-start gap-5 px-4 py-24 sm:px-6 lg:px-10">
      <span className="label-caps">Error 404</span>
      <h1 className="text-5xl">Page not found</h1>
      <p className="max-w-[560px] text-muted-foreground">
        The page you were looking for does not exist or has moved. Product links change when a
        product is renamed; those redirect automatically.
      </p>
      <Button asChild>
        <Link href="/">Back to the homepage</Link>
      </Button>
    </div>
  );
}
