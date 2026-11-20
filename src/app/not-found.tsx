import Link from "next/link";

export const metadata = { title: "Page not found", robots: { index: false } };

/** Fallback 404 outside the public layout (e.g. unknown admin URLs). */
export default function RootNotFound() {
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col items-start gap-5 px-4 py-24 sm:px-6 lg:px-10"
    >
      <span className="label-caps">Error 404</span>
      <h1 className="text-5xl">Page not found</h1>
      <Link href="/" className="text-primary">
        Back to the homepage
      </Link>
    </main>
  );
}
