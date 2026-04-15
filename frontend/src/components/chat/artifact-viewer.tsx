import { useEffect, useState } from 'react'
import { useStore } from '@/store/use-store'
import { filesApi } from '@/lib/api-client'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ImageViewer } from './viewers/image-viewer'
import { HtmlViewer } from './viewers/html-viewer'
import { CodeViewer } from './viewers/code-viewer'
import { MarkdownViewer } from './viewers/markdown-viewer'
import { CsvViewer } from './viewers/csv-viewer'
import { ExternalLink, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { triggerDownload } from '@/lib/utils'

export function ArtifactViewer() {
  const { selectedFile, setSelectedFile } = useStore()
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  
  useEffect(() => {
    if (!selectedFile) {
      setFileUrl(null)
      return
    }

    setFileUrl(filesApi.getViewUrl(selectedFile.thread_id, selectedFile.file_id))
  }, [selectedFile])

  if (!selectedFile) return null

  const getViewer = () => {
    if (!fileUrl) return null

    const type = selectedFile.content_type.toLowerCase()
    const filename = selectedFile.original_filename.toLowerCase()

    if (type.includes('image')) {
      return <ImageViewer url={fileUrl} alt={selectedFile.original_filename} />
    }
    
    if (filename.endsWith('.csv')) {
      return <CsvViewer url={fileUrl} filename={selectedFile.original_filename} />
    }

    if (filename.endsWith('.py') || filename.endsWith('.json') || filename.endsWith('.js') || filename.endsWith('.ts') || filename.endsWith('.sh')) {
      return <CodeViewer url={fileUrl} filename={selectedFile.original_filename} />
    }

    if (filename.endsWith('.md') || filename.endsWith('.txt')) {
      return <MarkdownViewer url={fileUrl} filename={selectedFile.original_filename} />
    }

    if (type.includes('html') || filename.endsWith('.html')) {
      return <HtmlViewer url={fileUrl} />
    }

    // Default to markdown/text for unknown text types or just the download link
    return (
      <div className="flex flex-col items-center justify-center p-24 text-center space-y-6 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border-2 border-dashed border-border/50">
        <div className="w-20 h-20 rounded-[2.5rem] bg-background border border-border shadow-xl flex items-center justify-center">
          <Download className="h-10 w-10 text-primary" />
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-black uppercase tracking-tight">No Preview Available</h3>
          <p className="text-sm text-slate-500 max-w-xs mx-auto">This file type cannot be previewed directly. You can download it to view locally.</p>
        </div>
        <Button
          onClick={() =>
            triggerDownload(
              filesApi.getDownloadUrl(selectedFile.thread_id, selectedFile.file_id),
              selectedFile.original_filename,
            )
          }
          className="rounded-xl px-8 h-12 font-bold uppercase tracking-widest text-[11px] shadow-lg shadow-primary/20"
        >
          Download File
        </Button>
      </div>
    )
  }

  return (
    <Dialog open={!!selectedFile} onOpenChange={(open) => !open && setSelectedFile(null)}>
      <DialogContent className="max-w-[95vw] w-[1200px] h-[85vh] p-0 overflow-hidden bg-background/80 backdrop-blur-2xl border-border/40 shadow-2xl flex flex-col rounded-[2rem]">
        <DialogHeader className="p-4 border-b border-border/40 flex flex-row items-center justify-between space-y-0 bg-background/40">
          <DialogTitle className="flex items-center gap-3">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/50">Artifact Preview</span>
            <span className="text-sm font-bold truncate max-w-[400px]">{selectedFile.original_filename}</span>
          </DialogTitle>
          <div className="flex items-center gap-2 pr-8">
            {fileUrl && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-9 w-9 rounded-xl hover:bg-primary/5 hover:text-primary transition-all"
                onClick={() =>
                  triggerDownload(
                    filesApi.getDownloadUrl(selectedFile.thread_id, selectedFile.file_id),
                    selectedFile.original_filename,
                  )
                }
              >
                <ExternalLink className="h-4.5 w-4.5" />
              </Button>
            )}
          </div>
        </DialogHeader>
        <div className="flex-1 p-0 overflow-hidden">
          {!fileUrl ? (
            <div className="h-full flex items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Loading Content...</span>
              </div>
            </div>
          ) : (
            <div className="h-full">
              {getViewer()}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
