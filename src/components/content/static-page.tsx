import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Container } from "@/components/ui/section";

export function StaticPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <Container className="flex flex-col gap-6 py-10">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: title }]} />
      <h1 className="text-5xl">{title}</h1>
      {intro ? <p className="max-w-[68ch] text-lg text-muted-foreground">{intro}</p> : null}
      <div className="flex max-w-[68ch] flex-col gap-4 text-[17px] leading-relaxed [&_h2]:mt-6 [&_h2]:text-3xl [&_li]:mb-1 [&_ul]:list-disc [&_ul]:pl-6">
        {children}
      </div>
    </Container>
  );
}
