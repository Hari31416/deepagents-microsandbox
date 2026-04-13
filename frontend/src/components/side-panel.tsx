import { useState, useEffect } from "react"
import { useStore } from "@/store/use-store"
import { threadsApi, filesApi } from "@/lib/api-client"
import type { ThreadFile } from "@/lib/api-client"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FileIcon, ImageIcon, FileSpreadsheet, Download, ExternalLink, RefreshCw, FolderOpen } from "lucide-react"
import { cn } from "@/lib/utils"

export function SidePanel() {
  const { activeThreadId, threadFiles, setThreadFiles } = useStore()
  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState("files")
  
  const files = activeThreadId ? threadFiles[activeThreadId] || [] : []

  const fetchFiles = async () => {
    if (!activeThreadId) return
    setIsLoading(true)
    try {
      const data = await threadsApi.getFiles(activeThreadId)
      setThreadFiles(activeThreadId, data.files)
    } catch (err) {
      console.error("Failed to fetch files:", err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchFiles()
  }, [activeThreadId])

  const handleDownload = async (file: ThreadFile) => {
    try {
      const presign = await filesApi.presignDownload({
        thread_id: file.thread_id,
        file_id: file.file_id
      })
      window.open(presign.url, "_blank")
    } catch (err) {
      console.error("Download failed:", err)
    }
  }

  const getFileIcon = (type: string) => {
    if (type.includes("image")) return <ImageIcon className="h-4 w-4" />
    if (type.includes("csv") || type.includes("sheet")) return <FileSpreadsheet className="h-4 w-4" />
    return <FileIcon className="h-4 w-4" />
  }

  if (!activeThreadId) return null

  return (
    <aside className="w-80 border-l border-border bg-card flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b border-border bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-xs tracking-wider uppercase text-slate-500">
          <FolderOpen className="h-4 w-4" />
          Workspace
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={fetchFiles} disabled={isLoading}>
          <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 pt-4">
          <TabsList className="grid w-full grid-cols-2 h-8">
            <TabsTrigger value="files" className="text-[10px] uppercase font-bold tracking-tighter">Files</TabsTrigger>
            <TabsTrigger value="artifacts" className="text-[10px] uppercase font-bold tracking-tighter">Artifacts</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="files" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full px-4 py-4">
            <div className="space-y-2">
              {files.filter(f => f.purpose === "upload").length === 0 ? (
                <div className="py-20 text-center text-slate-400">
                   <FileIcon className="h-8 w-8 mx-auto mb-2 opacity-20" />
                   <p className="text-[10px] uppercase font-semibold">No uploads yet</p>
                </div>
              ) : (
                files.filter(f => f.purpose === "upload").map(file => (
                  <FileItem key={file.file_id} file={file} onDownload={() => handleDownload(file)} icon={getFileIcon(file.content_type)} />
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="artifacts" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full px-4 py-4">
            <div className="space-y-2">
              {files.filter(f => f.purpose !== "upload").length === 0 ? (
                <div className="py-20 text-center text-slate-400">
                   <Download className="h-8 w-8 mx-auto mb-2 opacity-20" />
                   <p className="text-[10px] uppercase font-semibold">No generated artifacts</p>
                </div>
              ) : (
                files.filter(f => f.purpose !== "upload").map(file => (
                  <FileItem key={file.file_id} file={file} onDownload={() => handleDownload(file)} icon={getFileIcon(file.content_type)} />
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
      
      <div className="p-4 border-t border-border bg-slate-50/30">
         <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3 border border-blue-100 dark:border-blue-800">
            <h4 className="text-[10px] font-bold text-blue-700 dark:text-blue-400 uppercase tracking-widest mb-1">Sandbox Status</h4>
            <p className="text-[10px] text-blue-600 dark:text-blue-300 leading-tight">Environment is ready for execution. File isolation is active.</p>
         </div>
      </div>
    </aside>
  )
}

function FileItem({ file, onDownload, icon }: { file: ThreadFile, onDownload: () => void, icon: React.ReactNode }) {
  return (
    <div className="group flex items-center justify-between p-2 rounded-lg border border-transparent hover:border-slate-200 hover:bg-white transition-all">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
          {icon}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-medium truncate">{file.original_filename}</span>
          <span className="text-[10px] text-slate-400">{(file.size / 1024).toFixed(1)} KB • {new Date(file.created_at).toLocaleDateString()}</span>
        </div>
      </div>
      <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDownload}>
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
