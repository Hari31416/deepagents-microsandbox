import { useState } from "react"
import { MoreHorizontal, Pencil, Plus, MessageSquare, Menu, Terminal, Trash2 } from "lucide-react"
import { useStore } from "@/store/use-store"
import { threadsApi } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

export function Sidebar() {
  const { threads, setThreads, activeThreadId, setActiveThreadId, removeThread, isSidebarOpen, toggleSidebar } = useStore()

  const [isRenameOpen, setIsRenameOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [threadToEdit, setThreadToEdit] = useState<{ id: string; title: string } | null>(null)
  const [threadToDelete, setThreadToDelete] = useState<{ id: string; title: string } | null>(null)
  const [newTitle, setNewTitle] = useState("")
  const [isActionLoading, setIsActionLoading] = useState(false)

  const handleCreateThread = async () => {
    try {
      const newThread = await threadsApi.create("New Conversation")
      setThreads([newThread, ...threads])
      setActiveThreadId(newThread.thread_id)
    } catch (err) {
      console.error("Failed to create thread:", err)
    }
  }

  const handleRenameThread = (threadId: string, currentTitle?: string) => {
    setThreadToEdit({ id: threadId, title: currentTitle || "" })
    setNewTitle(currentTitle || "")
    setIsRenameOpen(true)
  }

  const handleDeleteThread = (threadId: string, title?: string) => {
    setThreadToDelete({ id: threadId, title: title || "Untitled Conversation" })
    setIsDeleteOpen(true)
  }

  const confirmRename = async () => {
    if (!threadToEdit) return

    setIsActionLoading(true)
    try {
      const updatedThread = await threadsApi.update(threadToEdit.id, newTitle.trim() || null)
      setThreads(threads.map((thread) => (thread.thread_id === threadToEdit.id ? updatedThread : thread)))
      setIsRenameOpen(false)
    } catch (err) {
      console.error("Failed to rename thread:", err)
    } finally {
      setIsActionLoading(false)
    }
  }

  const confirmDelete = async () => {
    if (!threadToDelete) return

    setIsActionLoading(true)
    try {
      await threadsApi.delete(threadToDelete.id)
      removeThread(threadToDelete.id)

      if (activeThreadId === threadToDelete.id) {
        const remainingThreads = threads.filter((item) => item.thread_id !== threadToDelete.id)
        const threadIndex = threads.findIndex((thread) => thread.thread_id === threadToDelete.id)
        const fallbackThread = remainingThreads[threadIndex] || remainingThreads[threadIndex - 1] || remainingThreads[0]
        setActiveThreadId(fallbackThread?.thread_id || null)
      }
      setIsDeleteOpen(false)
    } catch (err) {
      console.error("Failed to delete thread:", err)
    } finally {
      setIsActionLoading(false)
    }
  }

  if (!isSidebarOpen) {
    return (
      <div className="flex flex-col items-center py-6 w-16 border-r border-border/50 bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl gap-4">
        <Button variant="ghost" size="icon" onClick={toggleSidebar} className="rounded-full hover:bg-primary/5 hover:text-primary transition-all">
          <Menu className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleCreateThread}
          className="rounded-full bg-slate-900 dark:bg-primary text-white hover:bg-slate-800 dark:hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all active:scale-95"
        >
          <Plus className="h-5 w-5" />
        </Button>
      </div>
    )
  }

  return (
    <aside className="w-72 max-w-[18rem] min-w-[18rem] border-r border-border/50 bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl flex flex-col h-full transition-all duration-300 relative z-30 overflow-hidden">
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
          <span className="text-xs font-black uppercase tracking-widest">New Chat</span>
        </Button>
      </div>

      <div className="px-5 mb-2">
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-3 block">Conversations</span>
      </div>

      <ScrollArea className="flex-1 px-3 w-full max-w-full overflow-hidden">
        <div className="space-y-1 w-full min-w-0">
          {threads.map((thread) => (
            <div
              key={thread.thread_id}
              className={cn(
                "relative w-full min-w-0 rounded-xl transition-all group overflow-hidden",
                activeThreadId === thread.thread_id
                  ? "bg-primary/5 text-primary border border-primary/10 shadow-sm"
                  : "text-slate-500 hover:bg-slate-100/50 dark:hover:bg-slate-800/30 hover:text-slate-900 dark:hover:text-slate-200"
              )}
            >
              <button
                onClick={() => setActiveThreadId(thread.thread_id)}
                className="flex w-full min-w-0 items-center gap-4 px-4 py-3 pr-14 text-left relative overflow-hidden"
              >
                <div className="shrink-0">
                  <MessageSquare className={cn(
                    "h-4 w-4 transition-transform group-hover:scale-110",
                    activeThreadId === thread.thread_id ? "text-primary" : "text-slate-400"
                  )} />
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className={cn(
                      "block truncate text-xs font-bold leading-none min-w-0 flex-1 transition-colors",
                      activeThreadId === thread.thread_id ? "" : "font-medium"
                    )}>
                      {thread.title || "Untitled Conversation"}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    <p className="font-bold text-xs">{thread.title || "Untitled Conversation"}</p>
                  </TooltipContent>
                </Tooltip>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 rounded-lg bg-white/80 backdrop-blur-sm dark:bg-slate-950/80",
                      activeThreadId === thread.thread_id
                        ? "opacity-100"
                        : "opacity-60 group-hover:opacity-100 data-[state=open]:opacity-100"
                    )}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={() => handleRenameThread(thread.thread_id, thread.title)}>
                    <Pencil className="h-4 w-4" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleDeleteThread(thread.thread_id, thread.title)}
                    className="text-red-600 focus:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Rename Dialog */}
      <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Conversation</DialogTitle>
            <DialogDescription>
              Enter a new name for this conversation.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Conversation title"
              onKeyDown={(e) => e.key === "Enter" && confirmRename()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsRenameOpen(false)} disabled={isActionLoading}>
              Cancel
            </Button>
            <Button onClick={confirmRename} disabled={isActionLoading}>
              {isActionLoading ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Conversation</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <span className="font-bold text-foreground">"{threadToDelete?.title}"</span>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setIsDeleteOpen(false)} disabled={isActionLoading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={isActionLoading}>
              {isActionLoading ? "Deleting..." : "Delete Conversation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
