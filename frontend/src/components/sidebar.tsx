import { Plus, MessageSquare, Menu, Terminal } from "lucide-react"
import { useStore } from "@/store/use-store"
import { threadsApi } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

export function Sidebar() {
  const { threads, setThreads, activeThreadId, setActiveThreadId, isSidebarOpen, toggleSidebar } = useStore()

  const handleCreateThread = async () => {
    try {
      const newThread = await threadsApi.create("New Conversation")
      setThreads([newThread, ...threads])
      setActiveThreadId(newThread.thread_id)
    } catch (err) {
      console.error("Failed to create thread:", err)
    }
  }

  if (!isSidebarOpen) {
    return (
      <div className="flex flex-col items-center py-4 w-12 border-right border-border bg-card">
        <Button variant="ghost" size="icon" onClick={toggleSidebar}>
          <Menu className="h-5 w-5" />
        </Button>
      </div>
    )
  }

  return (
    <aside className="w-64 border-r border-border bg-card flex flex-col h-full transition-all duration-300">
      <div className="p-4 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2 font-semibold">
          <Terminal className="h-5 w-5 text-slate-900" />
          <span>DeepAgent</span>
        </div>
        <Button variant="ghost" size="icon" onClick={toggleSidebar}>
          <Menu className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-4">
        <Button className="w-full flex items-center gap-2 justify-start" variant="outline" onClick={handleCreateThread}>
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-2 space-y-1">
          {threads.map((thread) => (
            <button
              key={thread.thread_id}
              onClick={() => setActiveThreadId(thread.thread_id)}
              className={cn(
                "w-full text-left px-3 py-2 rounded-md transition-colors flex items-center gap-3 text-sm",
                activeThreadId === thread.thread_id 
                  ? "bg-slate-100 dark:bg-slate-800 font-medium text-slate-950 dark:text-slate-50" 
                  : "text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-900"
              )}
            >
              <MessageSquare className="h-4 w-4 shrink-0" />
              <span className="truncate">{thread.title || "Untitled Chat"}</span>
            </button>
          ))}
        </div>
      </ScrollArea>

      <div className="p-4 border-t border-border mt-auto">
        <div className="flex items-center gap-2 px-2">
          <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">
            DU
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium truncate">Dev User</span>
            <span className="text-[10px] text-slate-400 truncate">dev-user-123</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
