"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { PublicImage } from "@/modules/media/public";

/** Product images: one large image and, when there are several, thumbnail buttons to switch it. */
export function ProductGallery({ images }: { images: PublicImage[] }) {
  const [index, setIndex] = useState(0);
  const current = images[Math.min(index, images.length - 1)]!;
  return (
    <figure className="flex flex-col gap-3">
      <div className="flex aspect-square items-center justify-center bg-background p-4">
        {/* Uploaded, validated files served from our own storage; dimensions vary, so no next/image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.src} alt={current.alt} className="max-h-full max-w-full object-contain" />
      </div>
      {images.length > 1 ? (
        <div role="group" aria-label="Product images" className="flex flex-wrap gap-2 px-3 pb-3">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-pressed={i === index}
              aria-label={`Show image ${i + 1}: ${img.alt}`}
              className={cn(
                "size-16 border bg-background p-1 hover:border-primary",
                i === index && "border-primary outline outline-1 outline-primary",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.src} alt="" className="size-full object-contain" />
            </button>
          ))}
        </div>
      ) : null}
      {current.attribution ? (
        <figcaption className="px-3 pb-3 text-xs text-muted-foreground">
          {current.attributionUrl ? (
            <a href={current.attributionUrl} rel="noopener" className="hover:text-primary">
              {current.attribution}
            </a>
          ) : (
            current.attribution
          )}
        </figcaption>
      ) : null}
    </figure>
  );
}
