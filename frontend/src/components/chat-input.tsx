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
        <div className="absolute inset-0 bg-slate-400/10 blur-xl rounded-2xl group-focus-within:bg-slate-900/10 transition-colors" />
        <div className="relative flex flex-col items-end gap-2 bg-background border border-border rounded-xl p-2 shadow-sm focus-within:ring-2 focus-within:ring-slate-950 focus-within:ring-offset-2 transition-all">
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={disabled}
            placeholder="Describe your data or ask for an analysis..."
            className="w-full bg-transparent border-none focus:ring-0 resize-none px-3 py-2 text-sm max-h-32 min-h-[40px]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
          
          <div className="flex items-center justify-between w-full px-2 pb-1">
            <div className="flex items-center gap-1">
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
                className="h-8 w-8 text-slate-500 hover:text-slate-900"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || isUploading}
              >
                {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              </Button>
              <div className="text-[10px] text-slate-400 font-medium ml-2">
                {uploadedFileIds.length > 0
                  ? `${uploadedFileIds.length} workspace file${uploadedFileIds.length === 1 ? "" : "s"} available • `
                  : ""}
                Markdown supported • Shift+Enter for new line
              </div>
            </div>
            
            <Button 
              size="sm" 
              className="h-8 rounded-lg gap-2 bg-slate-900 hover:bg-slate-800 text-white transition-all active:scale-95"
              onClick={handleSend}
              disabled={disabled || !input.trim()}
            >
              <span className="text-xs font-semibold">Send Message</span>
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
