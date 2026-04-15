import { useEffect, useState } from 'react'
import { MarkdownRenderer } from '../markdown-renderer'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

interface MarkdownViewerProps {
  url: string
  filename: string
}

export function MarkdownViewer({ url }: MarkdownViewerProps) {
  const [content, setContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRaw, setIsRaw] = useState(false)

  const fetchContent = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(url, { credentials: 'include' })
      const text = await response.text()
      setContent(text)
    } catch (err) {
      console.error('Failed to fetch markdown content:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchContent()
  }, [url])

  return (
    <div className="flex flex-col h-full overflow-hidden font-sans">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-50/50 dark:bg-slate-900/50 border-b border-border/10">
        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="sm" 
            className={`h-7 px-3 text-[10px] font-black uppercase tracking-widest rounded-md transition-all ${!isRaw ? 'bg-primary/10 text-primary' : 'text-slate-400'}`}
            onClick={() => setIsRaw(false)}
          >
            Preview
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            className={`h-7 px-3 text-[10px] font-black uppercase tracking-widest rounded-md transition-all ${isRaw ? 'bg-primary/10 text-primary' : 'text-slate-400'}`}
            onClick={() => setIsRaw(true)}
          >
            Raw
          </Button>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md opacity-60 hover:opacity-100" onClick={fetchContent} disabled={isLoading}>
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden bg-white dark:bg-slate-950">
        <ScrollArea className="h-full">
          {isLoading ? (
            <div className="flex items-center justify-center p-24">
              <RefreshCw className="h-8 w-8 animate-spin text-slate-200" />
            </div>
          ) : isRaw ? (
            <div className="p-8 font-mono text-sm whitespace-pre-wrap leading-relaxed text-slate-700 dark:text-slate-300">
              {content}
            </div>
          ) : (
            <div className="p-8 max-w-4xl mx-auto">
              <MarkdownRenderer content={content || ''} role="assistant" />
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}
