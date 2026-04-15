import { useEffect, useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { RefreshCw, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

interface CodeViewerProps {
  url: string
  filename: string
}

export function CodeViewer({ url, filename }: CodeViewerProps) {
  const [content, setContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  
  const language = filename.split('.').pop() || 'python'

  const fetchContent = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(url, { credentials: 'include' })
      const text = await response.text()
      setContent(text)
    } catch (err) {
      console.error('Failed to fetch code content:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchContent()
  }, [url])

  const handleCopy = () => {
    if (!content) return
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            {language}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md text-slate-400 hover:text-primary hover:bg-slate-700" onClick={handleCopy}>
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md text-slate-400 hover:text-primary hover:bg-slate-700" onClick={fetchContent} disabled={isLoading}>
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden bg-slate-900 shadow-inner">
        <ScrollArea className="h-full">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <RefreshCw className="h-8 w-8 animate-spin text-slate-700" />
            </div>
          ) : (
            <SyntaxHighlighter
              style={vscDarkPlus as any}
              language={language}
              PreTag="div"
              customStyle={{
                margin: 0,
                padding: '1.5rem',
                backgroundColor: 'transparent',
                fontSize: '13px',
                lineHeight: '1.6',
              }}
              showLineNumbers
            >
              {content || ''}
            </SyntaxHighlighter>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}
