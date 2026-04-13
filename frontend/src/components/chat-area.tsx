import { useState, useRef, useEffect } from "react"
import { useStore } from "@/store/use-store"
import { streamChat } from "@/lib/api-client"
import { ChatInput } from "./chat-input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Bot, User as UserIcon, Loader2, Info, Terminal } from "lucide-react"
import ReactMarkdown from "react-markdown"
import { cn } from "@/lib/utils"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  isStreaming?: boolean
}

export function ChatArea() {
  const { activeThreadId, threads } = useStore()
  const [messages, setMessages] = useState<Record<string, Message[]>>({})
  const [isStreaming, setIsStreaming] = useState(false)
  const activeMessages = activeThreadId ? messages[activeThreadId] || [] : []
  const activeThread = threads.find(t => t.thread_id === activeThreadId)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [activeMessages])

  const handleSendMessage = async (content: string, fileIds: string[]) => {
    if (!activeThreadId) return

    const userMsg: Message = {
      id: Math.random().toString(36).substring(7),
      role: "user",
      content
    }

    setMessages(prev => ({
      ...prev,
      [activeThreadId]: [...(prev[activeThreadId] || []), userMsg]
    }))

    setIsStreaming(true)

    // Placeholder for assistant message
    const assistantMsgId = Math.random().toString(36).substring(7)
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      isStreaming: true
    }

    setMessages(prev => ({
      ...prev,
      [activeThreadId]: [...(prev[activeThreadId] || []), assistantMsg]
    }))

    try {
      let fullContent = ""
      const stream = streamChat({
        thread_id: activeThreadId,
        message: content,
        selected_file_ids: fileIds
      })

      for await (const event of stream) {
        if (event.event === "message" || event.event === "delta") {
          const delta = typeof event.data === "string" ? event.data : event.data?.delta || ""
          fullContent += delta

          setMessages(prev => ({
            ...prev,
            [activeThreadId]: (prev[activeThreadId] || []).map(m =>
              m.id === assistantMsgId ? { ...m, content: fullContent } : m
            )
          }))
        }
      }

      setMessages(prev => ({
        ...prev,
        [activeThreadId]: (prev[activeThreadId] || []).map(m =>
          m.id === assistantMsgId ? { ...m, isStreaming: false } : m
        )
      }))

    } catch (err) {
      console.error("Streaming error:", err)
      setMessages(prev => ({
        ...prev,
        [activeThreadId]: (prev[activeThreadId] || []).map(m =>
          m.id === assistantMsgId ? { ...m, content: (m.content + "\n\n[Error: Connection lost]"), isStreaming: false } : m
        )
      }))
    } finally {
      setIsStreaming(false)
    }
  }

  if (!activeThreadId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
        <Bot className="h-12 w-12 mb-4 opacity-20" />
        <h3 className="text-lg font-medium">No active conversation</h3>
        <p className="max-w-xs text-sm">Select a thread from the sidebar or create a new one to get started.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50/50 dark:bg-[#0b0c10]/50 relative">
      <header className="h-14 border-b border-border bg-background/80 backdrop-blur-sm px-6 flex items-center justify-between sticky top-0 z-10">
        <div className="flex flex-col min-w-0">
          <h2 className="text-sm font-semibold truncate">{activeThread?.title || "Untitled Conversation"}</h2>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400">Thread ID: {activeThreadId}</span>
            <Badge variant="outline" className="text-[9px] h-4 py-0 px-1 font-normal uppercase tracking-wider bg-slate-100/50">Active</Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-900">
            <Info className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <ScrollArea className="flex-1 h-full">
        <div className="max-w-3xl mx-auto py-8 px-6 space-y-8">
          {activeMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-slate-100 dark:bg-slate-900 flex items-center justify-center">
                <Terminal className="h-8 w-8 text-slate-900 dark:text-slate-50" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold tracking-tight">How can I help you today?</h3>
                <p className="text-sm text-slate-500 max-w-sm">
                  Upload your data files, ask for analyses, or have me create custom charts in the sandbox environment.
                </p>
              </div>
            </div>
          )}
          {activeMessages.map((msg) => (
            <div key={msg.id} className={cn(
              "flex gap-4",
              msg.role === "assistant" ? "bg-white/50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800" : ""
            )}>
              <div className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                msg.role === "assistant" ? "bg-slate-900 text-white" : "bg-white border border-border"
              )}>
                {msg.role === "assistant" ? <Bot className="h-5 w-5" /> : <UserIcon className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">
                  {msg.role === "assistant" ? "AI Agent" : "You"}
                </div>
                <div className="prose prose-sm prose-slate dark:prose-invert max-w-none">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                  {msg.isStreaming && <Loader2 className="h-4 w-4 animate-spin text-slate-400 mt-2" />}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} className="h-4" />
        </div>
      </ScrollArea>

      <div className="p-6 max-w-3xl mx-auto w-full sticky bottom-0">
        <ChatInput onSend={handleSendMessage} disabled={isStreaming} />
      </div>
    </div>
  )
}
