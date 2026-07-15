/**
 * Renders an assistant message as Markdown: GFM (tables, task lists, autolinks) plus
 * fenced code with syntax highlighting. Raw HTML is intentionally NOT enabled, so
 * untrusted model output cannot inject markup. Element styling lives under the `.md`
 * scope in index.css (Tailwind's preflight strips default element styles). See AgentPanel.
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Links open in a new tab; the agent's output is untrusted, so no opener.
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
