import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Root } from "mdast";
import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import remarkGfm from "remark-gfm";

const remarkUnderline: Plugin<[], Root> = () => (tree, file) => {
  const source = String(file.value ?? "");
  visit(tree, "emphasis", (node) => {
    const offset = node.position?.start.offset;
    if (offset !== undefined && source[offset] === "_") {
      node.data = { ...node.data, hName: "u" };
    }
  });
};

const markdownComponents = {
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-[#278fca] underline underline-offset-2">
      {children}
    </a>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="my-3 border-l-2 border-[#d8dbe0] pl-3 text-[#656871]">{children}</blockquote>
  ),
  code: ({
    className,
    children,
  }: {
    className?: string;
    children?: ReactNode;
  }) => (
    <code
      className={
        className
          ? `${className} font-mono`
          : "rounded bg-[#f0f1f3] px-1.5 py-0.5 font-mono text-[0.9em] text-[#b33a57]"
      }
    >
      {children}
    </code>
  ),
  h1: ({ children }: { children?: ReactNode }) => (
    <h1 className="mb-2 mt-4 text-xl font-semibold text-[#23252a]">{children}</h1>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className="mb-2 mt-4 text-lg font-semibold text-[#23252a]">{children}</h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className="mb-1 mt-3 text-base font-semibold text-[#23252a]">{children}</h3>
  ),
  li: ({ children }: { children?: ReactNode }) => <li className="pl-1">{children}</li>,
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="my-2 list-decimal space-y-1 pl-6">{children}</ol>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="my-2 whitespace-pre-wrap leading-6 last:mb-0">{children}</p>
  ),
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="my-3 max-w-full overflow-x-auto rounded-xl bg-[#202127] p-4 text-[13px] leading-5 text-[#f3f3f5]">
      {children}
    </pre>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="my-2 list-disc space-y-1 pl-6">{children}</ul>
  ),
};

export function AssistantMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkUnderline]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  );
}
