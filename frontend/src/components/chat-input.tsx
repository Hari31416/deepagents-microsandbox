import { useRef, useState } from "react"
import { Loader2, Paperclip, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useStore } from "@/store/use-store"
import { filesApi, threadsApi } from "@/lib/api-client"

interface ChatInputProps {
  onSend: (message: string, fileIds: string[]) => void
  disabled?: boolean
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [input, setInput] = useState("")
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { activeThreadId, setThreadFiles, threadFiles } = useStore()
  const uploadedFileIds = activeThreadId
    ? (threadFiles[activeThreadId] || [])
        .filter((file) => file.purpose === "upload" && file.status === "completed")
        .map((file) => file.file_id)
    : []

  const handleSend = () => {
    const message = input.trim()
    if (!message) return

    onSend(message, uploadedFileIds)
    setInput("")
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0 || !activeThreadId) return

    setIsUploading(true)
    try {
      for (const file of files) {
        // Presign
        const presign = await filesApi.presignUpload({
          thread_id: activeThreadId,
          filename: file.name,
          content_type: file.type || "application/octet-stream",
          size: file.size,
          purpose: "upload"
        })

        // PUT to MinIO
        await fetch(presign.url, {
          method: "PUT",
          body: file,
          headers: presign.required_headers
        })

        // Complete
        await filesApi.completeUpload({
          thread_id: activeThreadId,
          object_key: presign.object_key,
          original_filename: file.name,
          content_type: file.type || "application/octet-stream",
          size: file.size,
          purpose: "upload"
        })
      }

      // Refresh file list
      const { files: updatedFiles } = await threadsApi.getFiles(activeThreadId)
      setThreadFiles(activeThreadId, updatedFiles)
      
    } catch (err) {
      console.error("Upload failed:", err)
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  return (
    <div className="space-y-4">
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-primary/50 to-primary/30 blur opacity-20 group-focus-within:opacity-40 transition-opacity rounded-2xl" />
        <div className="relative flex flex-col items-end gap-2 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl border border-slate-200/50 dark:border-slate-800/50 rounded-2xl p-3 shadow-2xl focus-within:ring-1 focus-within:ring-primary/40 transition-all">
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={disabled}
            placeholder="Interrogate data or orchestrate an analysis..."
            className="w-full bg-transparent border-none focus:ring-0 resize-none px-4 py-3 text-[15px] leading-relaxed max-h-48 min-h-[48px] placeholder:text-slate-400 dark:placeholder:text-slate-500 font-medium"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
          
          <div className="flex items-center justify-between w-full px-3 pb-1 pt-2 border-t border-slate-100 dark:border-slate-800/50">
            <div className="flex items-center gap-1.5">
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                className="hidden" 
                multiple 
              />
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-9 w-9 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-xl transition-all"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || isUploading}
              >
                {isUploading ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Paperclip className="h-4.5 w-4.5" />}
              </Button>
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest ml-3 hidden sm:block">
                {uploadedFileIds.length > 0
                  ? `${uploadedFileIds.length} files staged`
                  : "Staging ready"}
              </div>
            </div>
            
            <Button 
              size="sm" 
              className="h-10 px-6 rounded-xl gap-2.5 bg-slate-900 dark:bg-primary hover:bg-slate-800 dark:hover:bg-primary/90 text-white shadow-lg shadow-primary/20 transition-all active:scale-95 disabled:opacity-50 disabled:grayscale"
              onClick={handleSend}
              disabled={disabled || !input.trim()}
            >
              <span className="text-xs font-black uppercase tracking-widest">Execute</span>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
