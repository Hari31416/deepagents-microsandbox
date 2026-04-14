import { useState, useEffect } from "react"
import { useStore } from "@/store/use-store"
import { threadsApi, filesApi } from "@/lib/api-client"
import type { ThreadFile } from "@/lib/api-client"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FileIcon, ImageIcon, FileSpreadsheet, Download, RefreshCw, FolderOpen, PanelRightClose } from "lucide-react"
import { cn } from "@/lib/utils"

export function SidePanel() {
  const { activeThreadId, threadFiles, setThreadFiles, isWorkspaceOpen, toggleWorkspace } = useStore()
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
    <aside className={cn(
      "w-[340px] border-l border-border/50 bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl flex flex-col h-full overflow-hidden relative z-30 transition-all duration-300",
      !isWorkspaceOpen && "w-0 border-none px-0"
    )}>
      <div className="p-6 border-b border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-3 font-black text-[10px] tracking-[0.2em] uppercase text-slate-500">
          <div className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800">
            <FolderOpen className="h-3.5 w-3.5" />
          </div>
          Workspace
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-primary/5 hover:text-primary transition-all" onClick={fetchFiles} disabled={isLoading}>
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-primary/5 hover:text-primary transition-all" onClick={toggleWorkspace}>
            <PanelRightClose className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 pt-6">
          <TabsList className="grid w-full grid-cols-2 h-10 bg-slate-100/50 dark:bg-slate-900/50 rounded-xl p-1 border border-slate-200/50 dark:border-slate-800/50">
            <TabsTrigger value="files" className="text-[10px] uppercase font-black tracking-widest rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-sm">Files</TabsTrigger>
            <TabsTrigger value="artifacts" className="text-[10px] uppercase font-black tracking-widest rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-sm">Artifacts</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="files" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full px-2 py-6">
            <div className="space-y-3">
              {files.filter(f => f.purpose === "upload").length === 0 ? (
                <div className="py-24 text-center space-y-4">
                  <div className="w-16 h-16 rounded-[2rem] bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 flex items-center justify-center mx-auto opacity-40">
                    <FileIcon className="h-8 w-8 text-slate-400" />
                  </div>
                  <p className="text-[10px] uppercase font-black tracking-widest text-slate-400">No files uploaded</p>
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
          <ScrollArea className="h-full px-2 py-6">
            <div className="space-y-3">
              {files.filter(f => f.purpose !== "upload").length === 0 ? (
                <div className="py-24 text-center space-y-4">
                  <div className="w-16 h-16 rounded-[2rem] bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 flex items-center justify-center mx-auto opacity-40">
                    <Download className="h-8 w-8 text-slate-400" />
                  </div>
                  <p className="text-[10px] uppercase font-black tracking-widest text-slate-400">No artifacts yet</p>
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
    </aside>
  )
}

function FileItem({ file, onDownload, icon }: { file: ThreadFile, onDownload: () => void, icon: React.ReactNode }) {
  return (
    <div className="group flex items-center justify-between p-3 rounded-2xl border border-slate-100 dark:border-slate-800/50 hover:border-primary/20 hover:bg-white dark:hover:bg-slate-900/60 transition-all shadow-sm hover:shadow-md mx-0.5">
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 group-hover:text-primary transition-colors shrink-0">
          {icon}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate mb-0.5">{file.original_filename}</span>
          <span className="text-[10px] text-slate-400 font-mono">{(file.size / 1024).toFixed(1)} KB • {new Date(file.created_at).toLocaleDateString()}</span>
        </div>
      </div>
      <div className="flex items-center opacity-0 group-hover:opacity-100 transition-all scale-90 group-hover:scale-100">
        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl text-slate-400 hover:text-primary hover:bg-primary/10 transition-all" onClick={onDownload}>
          <Download className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
