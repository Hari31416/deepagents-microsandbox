import { useRef, useState, useEffect } from "react"
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { activeThreadId, setThreadFiles, threadFiles } = useStore()
  
  const uploadedFileIds = activeThreadId
    ? (threadFiles[activeThreadId] || [])
        .filter((file) => file.purpose === "upload" && file.status === "completed")
        .map((file) => file.file_id)
    : []

  // Auto-resize logic
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = "auto"
      const nextHeight = textarea.scrollHeight
      textarea.style.height = `${Math.min(nextHeight, 200)}px`
      textarea.style.overflowY = nextHeight > 200 ? "auto" : "hidden"
    }
  }, [input])

  const handleSend = () => {
    const message = input.trim()
    if (!message || disabled) return

    onSend(message, uploadedFileIds)
    setInput("")
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0 || !activeThreadId) return

    setIsUploading(true)
    try {
      for (const file of files) {
        const presign = await filesApi.presignUpload({
          thread_id: activeThreadId,
          filename: file.name,
          content_type: file.type || "application/octet-stream",
          size: file.size,
          purpose: "upload"
        })

        await fetch(presign.url, {
          method: "PUT",
          body: file,
          headers: presign.required_headers
        })

        await filesApi.completeUpload({
          thread_id: activeThreadId,
          file_id: presign.file_id,
        })
      }

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
    <div className="relative flex flex-col gap-2">
      {uploadedFileIds.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1">
          <div className="flex items-center gap-1.5 px-2 py-1 bg-primary/5 border border-primary/10 rounded-lg text-[10px] font-bold text-primary uppercase tracking-widest">
            <Paperclip className="h-3 w-3" />
            {uploadedFileIds.length} {uploadedFileIds.length === 1 ? "File" : "Files"} Attached
          </div>
        </div>
      )}

      <div className="relative group flex items-end gap-2 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-2xl p-2 px-3 shadow-sm focus-within:ring-1 focus-within:ring-primary/40 focus-within:border-primary/40 transition-all">
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
          className="h-9 w-9 shrink-0 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-xl transition-all mb-0.5"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isUploading}
        >
          {isUploading ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Paperclip className="h-4.5 w-4.5" />}
        </Button>
        
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={disabled}
          placeholder="Ask a question or describe an analysis..."
          className="w-full bg-transparent border-none focus:ring-0 resize-none px-2 py-2.5 text-[15px] leading-relaxed max-h-[200px] min-h-[44px] placeholder:text-slate-400 dark:placeholder:text-slate-500 font-medium overflow-y-hidden custom-scrollbar"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
        />
        
        <Button 
          size="icon" 
          className="h-9 w-9 shrink-0 rounded-xl bg-slate-900 dark:bg-primary hover:bg-slate-800 dark:hover:bg-primary/90 text-white shadow-lg shadow-primary/20 transition-all active:scale-95 disabled:opacity-50 disabled:grayscale mb-0.5"
          onClick={handleSend}
          disabled={disabled || !input.trim()}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
