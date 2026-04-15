import { useEffect, useState } from 'react'
import { ExternalLink, RefreshCw, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface HtmlViewerProps {
  url: string
}

export function HtmlViewer({ url }: HtmlViewerProps) {
  const [content, setContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchContent = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(url, { credentials: 'include' })
      if (!response.ok) throw new Error('Failed to fetch HTML content')
      const text = await response.text()
      setContent(text)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchContent()
  }, [url])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-50/50 dark:bg-slate-900/50 border-b border-border/10">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-orange-500 font-bold uppercase tracking-tighter">Preview</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md opacity-60 hover:opacity-100" onClick={fetchContent} disabled={isLoading}>
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md opacity-60 hover:opacity-100" onClick={() => window.open(url, '_blank')}>
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 relative bg-white overflow-hidden">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <RefreshCw className="h-8 w-8 animate-spin text-slate-300" />
          </div>
        ) : error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center space-y-4">
            <div className="p-4 rounded-full bg-red-50 dark:bg-red-950/20 text-red-500">
              <AlertCircle className="h-8 w-8" />
            </div>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchContent}>Try Again</Button>
          </div>
        ) : (
          <iframe
            srcDoc={content || ''}
            className="w-full h-full border-none"
            sandbox="allow-scripts"
            title="Artifact HTML Preview"
          />
        )}
      </div>
    </div>
  )
}
