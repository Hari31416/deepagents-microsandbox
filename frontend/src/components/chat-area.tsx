import { useEffect, useRef } from 'react'
import { Bot, PanelRightOpen, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useStore } from '@/store/use-store'
import { ChatInput } from './chat-input'
import { useChatMessages } from '@/hooks/use-chat-messages'
import { getLatestTodos } from '@/lib/chat-utils'
import { MessageItem } from './chat/message-item'
import { IntegratedTodoPanel } from './chat/integrated-todo-panel'

export function ChatArea() {
  const { activeThreadId, threads, isWorkspaceOpen, toggleWorkspace } = useStore()
  const { activeMessages, isStreaming, isHydratingHistory, handleSendMessage } = useChatMessages(activeThreadId)

  const activeThread = threads.find((thread) => thread.thread_id === activeThreadId)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (bottomRef.current && (activeMessages.length > 0 || isStreaming)) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [activeMessages, isStreaming])

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
    <div className="flex-1 flex flex-col h-full bg-slate-50/30 dark:bg-black/20 relative">
      <header className="h-16 border-b border-border/50 bg-background/60 backdrop-blur-xl px-6 flex items-center justify-between sticky top-0 z-20">
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold tracking-tight truncate">{activeThread?.title || 'Untitled Conversation'}</h2>
          </div>
        </div>
        {!isWorkspaceOpen && (
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-full transition-all"
              onClick={toggleWorkspace}
            >
              <PanelRightOpen className="h-4.5 w-4.5" />
            </Button>
          </div>
        )}
      </header>

      <ScrollArea className="flex-1 h-full">
        <div className="max-w-5xl mx-auto py-10 px-6 space-y-12 pb-32">
          {activeMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-32 text-center space-y-6">
              <div className="relative">
                <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full" />
                <div className="relative w-20 h-20 rounded-[2.5rem] bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-2xl shadow-primary/20 animate-float">
                  <Terminal className="h-10 w-10 text-white" />
                </div>
              </div>
              <div className="space-y-3">
                <h3 className="text-2xl font-black tracking-tight bg-gradient-to-br from-slate-900 to-slate-500 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">
                  DeepAgent Sandbox
                </h3>
                <p className="text-sm text-slate-500 max-w-sm leading-relaxed">
                  Start an analysis by uploading datasets or asking a question. I'll leverage the sandbox to execute code and visualize
                  results.
                </p>
              </div>
            </div>
          )}
          {activeMessages.map((message, idx) => (
            <MessageItem key={message.id} message={message} idx={idx} />
          ))}
          <div ref={bottomRef} className="h-20" />
        </div>
      </ScrollArea>

      <div className="w-full bg-background border-t border-border/50 sticky bottom-0 z-20">
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/90 to-transparent -top-20 pointer-events-none" />
        <div className="max-w-5xl mx-auto w-full relative px-6 py-4 space-y-4">
          {getLatestTodos(activeMessages).length > 0 && <IntegratedTodoPanel todos={getLatestTodos(activeMessages)} />}
          <ChatInput onSend={handleSendMessage} disabled={isStreaming || isHydratingHistory} />
        </div>
      </div>
    </div>
  )
}
