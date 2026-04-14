import { cn } from '@/lib/utils'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

export const MarkdownRenderer = ({ content, role, isStreaming }: { content: string; role: string; isStreaming?: boolean }) => {
  if (!content && isStreaming) return null

  return (
    <div
      className={cn(
        'prose transition-all max-w-none prose-sm',
        role === 'assistant' ? 'prose-slate dark:prose-invert' : 'prose-slate dark:prose-invert text-slate-700 dark:text-slate-300',
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '')
            const isInline = !className
            return !isInline && match ? (
              <SyntaxHighlighter
                style={vscDarkPlus as any}
                language={match[1]}
                PreTag="div"
                className="rounded-xl border border-slate-800 shadow-2xl my-6 !bg-slate-900/95"
                {...props}
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            ) : (
              <code
                className={cn('bg-slate-100 dark:bg-slate-800/50 px-1.5 py-0.5 rounded text-[13px] font-mono text-primary', className)}
                {...props}
              >
                {children}
              </code>
            )
          },
          p: ({ children }) => <p className="mb-4 last:mb-0 leading-relaxed">{children}</p>,
          table: ({ children }) => (
            <div className="my-6 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <table className="w-full border-collapse bg-white dark:bg-slate-900/50 text-left text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="bg-slate-50/50 dark:bg-slate-800/50 px-4 py-3 font-bold text-[11px] uppercase tracking-widest text-slate-400">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="border-t border-slate-100 dark:border-slate-800 px-4 py-3">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
