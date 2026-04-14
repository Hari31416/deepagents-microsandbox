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
      <div className="flex flex-col items-center py-6 w-16 border-r border-border/50 bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl">
        <Button variant="ghost" size="icon" onClick={toggleSidebar} className="rounded-full hover:bg-primary/5 hover:text-primary transition-all">
          <Menu className="h-5 w-5" />
        </Button>
      </div>
    )
  }

  return (
    <aside className="w-72 border-r border-border/50 bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl flex flex-col h-full transition-all duration-300 relative z-30">
      <div className="p-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
            <Terminal className="h-4.5 w-4.5 text-white" />
          </div>
          <span className="font-black tracking-tighter text-lg bg-gradient-to-br from-slate-900 to-slate-500 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">DeepAgent</span>
        </div>
        <Button variant="ghost" size="icon" onClick={toggleSidebar} className="h-8 w-8 rounded-full text-slate-400 hover:text-primary transition-all">
          <Menu className="h-4 w-4" />
        </Button>
      </div>

      <div className="px-5 pb-6">
        <Button
          className="w-full h-11 flex items-center gap-3 justify-center bg-slate-900 dark:bg-primary text-white rounded-xl shadow-lg shadow-primary/10 hover:shadow-primary/20 transition-all active:scale-[0.98]"
          onClick={handleCreateThread}
        >
          <Plus className="h-4 w-4" />
          <span className="text-xs font-black uppercase tracking-widest">New Intelligence</span>
        </Button>
      </div>

      <div className="px-5 mb-2">
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3 block">Conversations</span>
      </div>

      <ScrollArea className="flex-1 px-3">
        <div className="space-y-1">
          {threads.map((thread) => (
            <button
              key={thread.thread_id}
              onClick={() => setActiveThreadId(thread.thread_id)}
              className={cn(
                "w-full text-left px-4 py-3 rounded-xl transition-all flex items-center gap-4 group",
                activeThreadId === thread.thread_id 
                  ? "bg-primary/5 text-primary border border-primary/10 shadow-sm"
                  : "text-slate-500 hover:bg-slate-100/50 dark:hover:bg-slate-800/30 hover:text-slate-900 dark:hover:text-slate-200"
              )}
            >
              <MessageSquare className={cn(
                "h-4 w-4 shrink-0 transition-transform group-hover:scale-110",
                activeThreadId === thread.thread_id ? "text-primary" : "text-slate-400"
              )} />
              <span className={cn(
                "truncate text-xs font-bold leading-none",
                activeThreadId === thread.thread_id ? "" : "font-medium"
              )}>
                {thread.title || "Untitled Intelligence"}
              </span>
            </button>
          ))}
        </div>
      </ScrollArea>

      <div className="p-6 mt-auto">
        <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-100/50 dark:bg-slate-900/50 border border-slate-200/50 dark:border-slate-800/50">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-xs font-black text-white shadow-lg shadow-primary/10">
            DU
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">Dev User</span>
            <span className="text-[9px] text-slate-500 font-mono truncate">ID: dev-user-123</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
