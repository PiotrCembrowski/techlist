import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";

const components: Components = {
  h1: ({ children }) => <h2 className="mt-8 mb-3 text-3xl">{children}</h2>,
  h2: ({ children }) => <h2 className="mt-8 mb-3 text-3xl">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-6 mb-2 text-2xl">{children}</h3>,
  p: ({ children }) => <p className="mb-4 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="mb-4 list-disc pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="mb-4 list-decimal pl-6">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mb-4 border-l-2 border-primary pl-4 text-muted-foreground">
      {children}
    </blockquote>
  ),
  code: ({ children }) => <code className="bg-muted px-1 text-[0.9em]">{children}</code>,
  a: ({ href, children }) => {
    if (href?.startsWith("/")) {
      return (
        <Link href={href} className="text-primary underline">
          {children}
        </Link>
      );
    }
    return (
      <a
        href={href}
        rel="noopener noreferrer nofollow"
        target="_blank"
        className="text-primary underline"
      >
        {children}
      </a>
    );
  },
  img: () => null, // Images in guides must be uploaded and licensed (Stage 6A); none are hotlinked.
};

/**
 * Sanitised Markdown: raw HTML is dropped (skipHtml) and react-markdown's default URL transform
 * blocks javascript: and other unsafe protocols. No dangerouslySetInnerHTML.
 */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="max-w-[68ch] text-[17px]">
      <ReactMarkdown skipHtml components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
