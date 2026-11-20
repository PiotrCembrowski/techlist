import { highlight } from "@/modules/search/query";

/** Renders text with query matches wrapped in <mark> (no HTML injection: plain React nodes). */
export function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((p, i) =>
        p.match ? (
          <mark key={i} className="bg-primary/15 text-inherit">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
