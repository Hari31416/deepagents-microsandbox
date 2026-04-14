import { useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChatInput } from "./chat-input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useStore } from "@/store/use-store"
import { streamChat, threadsApi, type ThreadMessage, type ThreadRunEvent } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import {
  Bot,
  CheckCircle2,
  FileSearch,
  Info,
  Loader2,
  Radio,
  Terminal,
  User as UserIcon,
  Wrench,
  ChevronDown,
  ListTodo,
  Circle,
  CircleDashed,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { motion, AnimatePresence } from "framer-motion"

interface Todo {
  content: string
  status: "pending" | "in_progress" | "completed" | "failed"
}

interface StreamActivity {
  id: string
  label: string
  detail?: string
  kind: "metadata" | "tool_call" | "tool_result" | "status" | "error"
  state: "live" | "done" | "error"
  args?: string
  result?: string
}

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  isStreaming?: boolean
  runId?: string
  activities?: StreamActivity[]
}

interface StreamEnvelope {
  content?: string
  activities?: StreamActivity[]
  runId?: string
  isStreaming?: boolean
}

export function ChatArea() {
  const { activeThreadId, threads, updateThreadTitle, setThreadFiles } = useStore()
  const [messages, setMessages] = useState<Record<string, Message[]>>({})
  const [isStreaming, setIsStreaming] = useState(false)
  const [isHydratingHistory, setIsHydratingHistory] = useState(false)
  const activeMessages = activeThreadId ? messages[activeThreadId] || [] : []
  const activeThread = threads.find((thread) => thread.thread_id === activeThreadId)
  const bottomRef = useRef<HTMLDivElement>(null)

  
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [activeMessages, isStreaming])

  useEffect(() => {
    if (!activeThreadId) {
      return
    }

    let isCancelled = false
    setIsHydratingHistory(true)

    Promise.all([
      threadsApi.getMessages(activeThreadId),
      threadsApi.getEvents(activeThreadId),
    ])
      .then(([messageData, eventData]) => {
        if (isCancelled) {
          return
        }
        const activitiesByRun = buildActivitiesByRun(eventData.events)
        setMessages((prev) => ({
          ...prev,
          [activeThreadId]: messageData.messages.map((message) => mapPersistedMessage(message, activitiesByRun)),
        }))
      })
      .catch((error) => {
        if (!isCancelled) {
          console.error("Failed to fetch thread history:", error)
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsHydratingHistory(false)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [activeThreadId])

  const updateAssistantMessage = (
    threadId: string,
    assistantMsgId: string,
    patch: StreamEnvelope | ((message: Message) => StreamEnvelope),
  ) => {
    setMessages((prev) => ({
      ...prev,
      [threadId]: (prev[threadId] || []).map((message) => {
        if (message.id !== assistantMsgId) {
          return message
        }

        const nextPatch = typeof patch === "function" ? patch(message) : patch
        return { ...message, ...nextPatch }
      }),
    }))
  }

  const handleSendMessage = async (content: string, fileIds: string[]) => {
    if (!activeThreadId) return

    const threadId = activeThreadId
    const activeThreadRecord = threads.find((thread) => thread.thread_id === threadId)
    if (shouldPromoteMessageToTitle(activeThreadRecord?.title)) {
      updateThreadTitle(threadId, deriveThreadTitle(content))
    }
    const userMsg: Message = {
      id: Math.random().toString(36).substring(7),
      role: "user",
      content,
    }
    const assistantMsgId = Math.random().toString(36).substring(7)
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      isStreaming: true,
      activities: [],
    }

    setMessages((prev) => ({
      ...prev,
      [threadId]: [...(prev[threadId] || []), userMsg, assistantMsg],
    }))
    setIsStreaming(true)

    try {
      const stream = streamChat({
        thread_id: threadId,
        message: content,
        selected_file_ids: fileIds,
      })

      for await (const event of stream) {
        if (event.event === "metadata") {
          const runId = typeof event.data === "object" && event.data ? String(event.data.run_id || "") : ""
          updateAssistantMessage(threadId, assistantMsgId, (message) => ({
            runId: runId || message.runId,
            activities: upsertActivity(message.activities, {
              id: runId || event.id || "run-metadata",
              kind: "metadata",
              state: "live",
              label: "Run started",
              detail: runId ? `Run ID ${truncateMiddle(runId, 18)}` : "Streaming response connected",
            }),
          }))
          continue
        }

        if (event.event === "updates") {
          const streamState = extractStreamState(event.data)
          updateAssistantMessage(threadId, assistantMsgId, (message) => {
            const currentContent = message.content || ""
            const updateContent = streamState.content || ""
            
            // Only update content if we don't have a streaming delta version
            // or if the update provides a significantly cleaner/final version
            let nextContent = currentContent
            if (updateContent) {
              nextContent = updateContent
            }

            return {
              content: nextContent,
              activities: mergeActivities(message.activities, streamState.activities),
            }
          })
          continue
        }

        if (event.event === "message" || event.event === "delta") {
          const deltaData = typeof event.data === "string" ? { delta: event.data } : event.data
          const delta = deltaData?.delta || ""
          const metadata = deltaData?.metadata || {}

          // Hide deltas that come from internal nodes
          const node = deltaData?.node_name || metadata?.langgraph_node || ""
          const internalNodes = ["tools", "task", "write_todos", "planner", "orchestrator", "plan", "thought", "__start__", "__end__"]
          if (internalNodes.includes(node)) {
            continue
          }

          if (delta) {
            updateAssistantMessage(threadId, assistantMsgId, (message) => ({
              content: `${message.content}${delta}`,
            }))
          }
          continue
        }

        if (event.event === "error") {
          const detail = extractErrorMessage(event.data, event.rawData)
          updateAssistantMessage(threadId, assistantMsgId, (message) => ({
            content: message.content ? `${message.content}\n\n{detail}` : detail,
            isStreaming: false,
            activities: upsertActivity(message.activities, {
              id: event.id || "stream-error",
              kind: "error",
              state: "error",
              label: "Run failed",
              detail,
            }),
          }))
          continue
        }

        if (event.event === "done") {
          threadsApi.getFiles(threadId)
            .then((data) => {
              setThreadFiles(threadId, data.files)
            })
            .catch((error) => {
              console.error("Failed to refresh files:", error)
            })
          updateAssistantMessage(threadId, assistantMsgId, (message) => ({
            isStreaming: false,
            activities: upsertActivity(message.activities, {
              id: event.id || "run-done",
              kind: "status",
              state: "done",
              label: "Run completed",
            }),
          }))
        }
      }

      updateAssistantMessage(threadId, assistantMsgId, (message) => ({
        isStreaming: false,
        activities: markActivitiesComplete(message.activities),
      }))
    } catch (error) {
      console.error("Streaming error:", error)
      const detail = error instanceof Error ? error.message : "Connection lost"
      updateAssistantMessage(threadId, assistantMsgId, (message) => ({
        content: message.content ? `${message.content}\n\n[Error: ${detail}]` : `[Error: ${detail}]`,
        isStreaming: false,
        activities: upsertActivity(message.activities, {
          id: "stream-connection-error",
          kind: "error",
          state: "error",
          label: "Connection lost",
          detail,
        }),
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
    <div className="flex-1 flex flex-col h-full bg-slate-50/30 dark:bg-black/20 relative">
      <header className="h-16 border-b border-border/50 bg-background/60 backdrop-blur-xl px-8 flex items-center justify-between sticky top-0 z-20">
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold tracking-tight truncate">{activeThread?.title || "Untitled Conversation"}</h2>
            <Badge
              variant="outline"
              className="text-[9px] h-4 py-0 px-1.5 font-bold uppercase tracking-widest bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
            >
              Live
            </Badge>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-slate-400 font-mono">ID: {truncateMiddle(activeThreadId, 16)}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-9 w-9 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-full transition-all">
            <Info className="h-4.5 w-4.5" />
          </Button>
        </div>
      </header>

      <ScrollArea className="flex-1 h-full">
        <div className="max-w-4xl mx-auto py-10 px-8 space-y-12">
          {activeMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-32 text-center space-y-6">
              <div className="relative">
                <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full" />
                <div className="relative w-20 h-20 rounded-[2.5rem] bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-2xl shadow-primary/20 animate-float">
                  <Terminal className="h-10 w-10 text-white" />
                </div>
              </div>
              <div className="space-y-3">
                <h3 className="text-2xl font-black tracking-tight bg-gradient-to-br from-slate-900 to-slate-500 dark:from-white dark:to-slate-400 bg-clip-text text-transparent">Engineered to Assist</h3>
                <p className="text-sm text-slate-500 max-w-sm leading-relaxed">
                  Start an analysis by uploading datasets or asking a question. I'll leverage the sandbox to execute code and visualize results.
                </p>
              </div>
            </div>
          )}
          {activeMessages.map((message, idx) => (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: idx * 0.05 }}
              key={message.id}
              className={cn(
                "flex gap-6 items-start group",
                message.role === "assistant" ? "flex-row" : "flex-row"
              )}
            >
              <div
                className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-lg transition-transform group-hover:scale-105",
                  message.role === "assistant"
                    ? "bg-slate-900 dark:bg-primary text-white"
                    : "bg-white dark:bg-slate-800 border border-border",
                )}
              >
                {message.role === "assistant" ? <Bot className="h-6 w-6" /> : <UserIcon className="h-5 w-5 text-slate-600 dark:text-slate-300" />}
              </div>
              <div className="flex-1 min-w-0 space-y-4">
                <div className={cn(
                  "flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em]",
                  message.role === "assistant" ? "text-primary" : "text-slate-400"
                )}>
                  {message.role === "assistant" ? "Intelligence Engine" : "Human Operator"}
                  <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800/50" />
                </div>

                {message.role === "assistant" && (
                  <LiveTrace
                    activities={message.activities || []}
                    runId={message.runId}
                    isStreaming={Boolean(message.isStreaming)}
                  />
                )}

                <div className={cn(
                  "prose prose-slate dark:prose-invert max-w-none transition-all",
                  message.role === "assistant" ? "text-[15px] leading-relaxed" : "text-slate-700 dark:text-slate-300"
                )}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content || (message.isStreaming ? "" : "")}
                  </ReactMarkdown>
                  {message.isStreaming && !message.content && (
                    <div className="flex items-center gap-3 text-primary animate-pulse py-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-xs font-bold tracking-widest uppercase">Initializing Neural Synthesis...</span>
                    </div>
                  )}
                </div>

                {message.isStreaming && message.content && (
                  <div className="flex items-center gap-2 text-primary/60 border-t border-primary/10 pt-4 mt-4">
                    <div className="flex gap-1">
                      <div className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
                      <div className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
                      <div className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest">Streaming Output</span>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
          <div ref={bottomRef} className="h-20" />
        </div>
      </ScrollArea>

      <div className="pb-10 pt-4 px-8 max-w-4xl mx-auto w-full sticky bottom-0 z-20">
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent -top-12 pointer-events-none" />
        <div className="relative space-y-4">
          {getLatestTodos(activeMessages).length > 0 && (
            <IntegratedTodoPanel todos={getLatestTodos(activeMessages)} />
          )}
          <ChatInput onSend={handleSendMessage} disabled={isStreaming || isHydratingHistory} />
        </div>
      </div>
    </div>
  )
}
function LiveTrace({
  activities,
  runId,
  isStreaming,
}: {
  activities: StreamActivity[]
  runId?: string
  isStreaming: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(isStreaming)

  if (!runId && activities.length === 0 && !isStreaming) {
    return null
  }

  // Hide internal noise
  const filteredActivities = activities.filter(a =>
    !["Draft response updated", "Plan updated", "Task"].includes(a.label)
  )

  return (
    <div className="group/trace relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md shadow-sm transition-all duration-300">
      <div 
        className="flex items-center justify-between gap-4 px-4 py-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center">
            {isStreaming ? (
              <div className="h-4 w-4">
                <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" />
                <Loader2 className="h-4 w-4 animate-spin text-primary relative z-10" />
              </div>
            ) : (
              <Terminal className="h-3.5 w-3.5 text-slate-400" />
            )}
          </div>
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
            {isStreaming ? "Synthesizing Thought" : "Execution Trace"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {filteredActivities.length > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
              {filteredActivities.length} Steps
            </span>
          )}
          <ChevronDown className={cn(
            "h-3.5 w-3.5 text-slate-400 transition-transform duration-300",
            isExpanded ? "rotate-0" : "-rotate-90"
          )} />
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-slate-100 dark:border-slate-800/50"
          >
            <div className="p-3 bg-slate-50/50 dark:bg-slate-950/20 max-h-[400px] overflow-y-auto custom-scrollbar">
              <div className="relative pl-2.5 border-l border-slate-200 dark:border-slate-800 ml-1.5 space-y-4 py-2">
                {filteredActivities.length === 0 && isStreaming && (
                  <div className="flex items-center gap-2 py-2 text-primary/60">
                    <Radio className="h-3 w-3 animate-pulse" />
                    <span className="text-[10px] font-medium animate-pulse">Initializing pipeline...</span>
                  </div>
                )}

                {filteredActivities.map((activity, idx) => (
                  <div key={activity.id} className="relative group/item">
                    {/* Circle on timeline */}
                    <div className={cn(
                      "absolute -left-[14.5px] top-1.5 w-2 h-2 rounded-full border bg-background z-10 shadow-sm",
                      activity.state === "live" ? "border-primary animate-pulse shadow-primary/20" :
                        activity.state === "error" ? "border-rose-500" :
                          activity.state === "done" ? "border-emerald-500 bg-emerald-500/10" : "border-slate-300 dark:border-slate-700"
                    )} />

                    <div className="pl-4 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "text-[11px] font-bold tracking-tight",
                          activity.state === "error" ? "text-rose-500" : "text-slate-700 dark:text-slate-200"
                        )}>
                          {activity.label}
                        </span>
                        {activity.state === "live" && <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />}
                      </div>

                      {(activity.args || activity.result) && (
                        <ActivityDetails activity={activity} />
                      )}

                      {activity.detail && !activity.args && !activity.result && (
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed max-w-lg">
                          {activity.detail}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ActivityDetails({ activity }: { activity: StreamActivity }) {
  const [isOpen, setIsOpen] = useState(false)
  const isCode = activity.kind === "tool_call" || activity.kind === "tool_result"

  return (
    <div className="space-y-1.5">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100/80 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-[9px] font-black uppercase tracking-wider text-slate-500"
      >
        {isCode ? (isOpen ? "Hide Payload" : "View Payload") : (isOpen ? "Collapse" : "Expand Details")}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-lg bg-slate-900 dark:bg-black p-3 text-[10px] font-mono leading-relaxed text-slate-300 border border-slate-800/50 shadow-inner overflow-x-auto max-h-60 overflow-y-auto custom-scrollbar">
              {activity.args && (
                <div className="space-y-2">
                  <div className="text-[8px] text-slate-500 font-bold uppercase tracking-widest border-b border-slate-800 pb-1 mb-2">Input Parameters</div>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{activity.args}</ReactMarkdown>
                </div>
              )}
              {activity.result && (
                <div className="space-y-2 mt-4">
                  <div className="text-[8px] text-emerald-500/70 font-bold uppercase tracking-widest border-b border-slate-800 pb-1 mb-2">Output Result</div>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{activity.result}</ReactMarkdown>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function IntegratedTodoPanel({ todos }: { todos: Todo[] }) {
  const [isExpanded, setIsExpanded] = useState(false)
  if (!todos.length) return null

  const completedCount = todos.filter((t) => t.status === "completed").length
  const progress = (completedCount / todos.length) * 100
  const activeTask = todos.find((t) => t.status === "in_progress") || todos.find((t) => t.status === "pending")

  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-slate-200 dark:border-slate-800 rounded-2xl shadow-lg overflow-hidden transition-all duration-300"
    >
      <div
        className="px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <ListTodo className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Analysis Plan</span>
              <span className="text-[10px] font-bold text-primary tabular-nums">{completedCount}/{todos.length}</span>
            </div>
            <div className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
              {activeTask?.content || "Finalizing process..."}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="w-24 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden hidden sm:block">
            <motion.div
              className="h-full bg-primary"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
            />
          </div>
          <div className={cn(
            "p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 transition-all duration-300",
            isExpanded && "rotate-180 bg-primary/10 text-primary"
          )}>
            <ChevronDown className="h-4 w-4" />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-slate-100 dark:border-slate-800/50"
          >
            <div className="p-4 space-y-2.5 max-h-48 overflow-y-auto custom-scrollbar">
              {todos.map((todo, idx) => (
                <motion.div
                  key={idx}
                  initial={{ x: -10, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: idx * 0.03 }}
                  className="flex items-start gap-4 group"
                >
                  <div className="mt-0.5 shrink-0 transition-transform group-hover:scale-110">
                    {todo.status === "completed" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : todo.status === "in_progress" ? (
                      <CircleDashed className="h-4 w-4 text-primary animate-spin" />
                    ) : (
                      <Circle className="h-4 w-4 text-slate-300 dark:text-slate-700" />
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-[13px] leading-tight transition-all",
                      todo.status === "completed"
                        ? "text-slate-400 line-through decoration-slate-300"
                        : todo.status === "in_progress"
                          ? "text-slate-900 dark:text-white font-bold"
                          : "text-slate-600 dark:text-slate-400 font-medium",
                    )}
                  >
                    {todo.content}
                  </span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function getLatestTodos(messages: Message[]): Todo[] {
  // Traverse backwards to find the most recent set of todos
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role === "assistant" && message.activities) {
      // Find the latest activity that looks like a todo update
      const todoActivity = [...message.activities]
        .reverse()
        .find((a) => a.label.includes("write_todos") && a.args)

      if (todoActivity && todoActivity.args) {
        return parseTodos(todoActivity.args)
      }
    }
  }
  return []
}


function parseTodos(args: string): Todo[] {
  try {
    // Attempt to extract JSON from code blocks if present
    const jsonMatch = args.match(/```(?:json)?\s*([\s\S]*?)```/)
    const raw = jsonMatch ? jsonMatch[1] : args
    const parsed = JSON.parse(raw)

    const todos = Array.isArray(parsed) ? parsed : parsed.todos
    if (Array.isArray(todos)) {
      return todos.map((t: any) => ({
        content: t.content || t.task || t.description || "Unknown Task",
        status: t.status || "pending"
      }))
    }
  } catch (err) {
    console.error("Failed to parse todos:", err)
  }
  return []
}

function getActivityIcon(activity: StreamActivity) {
  if (activity.state === "error") {
    return <Info className="h-4 w-4 text-rose-500" />
  }

  if (activity.kind === "tool_call") {
    return activity.state === "live" ? (
      <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
    ) : (
      <Wrench className="h-4 w-4 text-amber-600" />
    )
  }

  if (activity.kind === "tool_result") {
    return <FileSearch className="h-4 w-4 text-sky-600" />
  }

  if (activity.kind === "metadata") {
    return <Radio className="h-4 w-4 text-emerald-600" />
  }

  if (activity.state === "done") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
  }

  return <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
}

function extractStreamState(payload: unknown): StreamEnvelope {
  if (!payload || typeof payload !== "object") {
    return {}
  }

  let content: string | undefined
  let activities: StreamActivity[] = []

  for (const [nodeName, nodeData] of Object.entries(payload as Record<string, unknown>)) {
    // Skip nodes that are primarily for state management or internal orchestration
    const isInternalNode = [
      "write_todos",
      "task",
      "plan",
      "orchestrator",
      "planner",
      "tools",
      "__start__",
      "__end__"
    ].includes(nodeName)

    if (isInternalNode) {
      // Still process these for activities (to show in trace), but don't let them update main chat content
    }

    if (nodeData === null) {
      activities = upsertActivity(activities, {
        id: `${nodeName}-idle`,
        kind: "status",
        state: "done",
        label: formatNodeLabel(nodeName),
      })
      continue
    }

    for (const message of extractNodeMessages(nodeData)) {
      const isAssistant = message.type === "ai" || message.role === "assistant"
      const messageContent = typeof message.content === "string" ? message.content.trim() : ""

      // Structural filter: If it's an assistant message, it only counts as "Chat Content" if:
      // 1. It's not from an internal node
      // 2. It doesn't contain tool calls (meaning it's a final prose response, not a planning step)
      if (isAssistant && messageContent && !isInternalNode) {
        const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0

        if (!hasToolCalls) {
          content = messageContent
        }
      }

      if ((message.type === "ai" || message.role === "assistant") && Array.isArray(message.tool_calls)) {
        for (const toolCall of message.tool_calls) {
          const id = toolCall.id || `${nodeName}-${toolCall.name}`
          activities = upsertActivity(activities, {
            id,
            kind: "tool_call",
            state: "live",
            label: `Running ${toolCall.name}`,
            args: summarizeArgs(toolCall.args),
          })
        }
      }

      if (message.type === "tool") {
        const id = message.tool_call_id || message.id || `${nodeName}-${message.name}`
        activities = upsertActivity(activities, {
          id,
          kind: "tool_result",
          state: message.status === "success" ? "done" : "error",
          label: `${message.name} ${message.status === "success" ? "finished" : "returned an error"}`,
          result: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
        })
      }
    }
  }

  return { content, activities }
}

function extractNodeMessages(nodeData: unknown): Array<Record<string, any>> {
  if (!nodeData || typeof nodeData !== "object") {
    return []
  }

  const record = nodeData as Record<string, unknown>
  const messages = "messages" in record ? record.messages : record.value

  if (Array.isArray(messages)) {
    return messages.filter((message): message is Record<string, any> => Boolean(message) && typeof message === "object")
  }

  if (messages && typeof messages === "object") {
    const nestedMessages = messages as Record<string, unknown>

    if (Array.isArray(nestedMessages.value)) {
      return nestedMessages.value.filter(
        (message): message is Record<string, any> => Boolean(message) && typeof message === "object",
      )
    }

    if (nestedMessages.value && typeof nestedMessages.value === "object") {
      return [nestedMessages.value as Record<string, any>]
    }
  }

  if (messages && typeof messages === "object") {
    return [messages as Record<string, any>]
  }

  if ("value" in record && Array.isArray(record.value)) {
    return record.value.filter((message): message is Record<string, any> => Boolean(message) && typeof message === "object")
  }

  return []
}

function mergeActivities(
  existing: StreamActivity[] | undefined,
  incoming: StreamActivity[] | undefined,
): StreamActivity[] {
  let next = [...(existing || [])]

  for (const activity of incoming || []) {
    next = upsertActivity(next, activity)
  }

  return next
}

function upsertActivity(
  activities: StreamActivity[] | undefined,
  incoming: StreamActivity,
): StreamActivity[] {
  const next = [...(activities || [])]
  const index = next.findIndex((activity) => activity.id === incoming.id)

  if (index >= 0) {
    next[index] = { ...next[index], ...incoming }
    return next
  }

  return [...next, incoming]
}

function markActivitiesComplete(activities: StreamActivity[] | undefined): StreamActivity[] {
  return (activities || []).map((activity) =>
    activity.state === "live" ? { ...activity, state: "done" } : activity,
  )
}

function summarizeArgs(args: unknown) {
  if (!args) {
    return "No arguments"
  }

  if (typeof args === "string") {
    return formatToolContent(args)
  }

  if (typeof args === "object") {
    const record = args as Record<string, unknown>
    const codeValue = firstStringValue(record, ["code", "script", "command", "cmd", "source"])
    if (codeValue) {
      return formatToolContent(codeValue, detectLanguage(record))
    }
  }

  try {
    return formatToolContent(JSON.stringify(args, null, 2), "json")
  } catch {
    return "Arguments unavailable"
  }
}

function previewText(value: string, limit = 160) {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= limit) {
    return normalized
  }
  return `${normalized.slice(0, limit - 1)}…`
}

function formatNodeLabel(nodeName: string) {
  return nodeName
    .split(".")
    .pop()
    ?.replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase()) || nodeName
}

function truncateMiddle(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }

  const headLength = Math.ceil((maxLength - 1) / 2)
  const tailLength = Math.floor((maxLength - 1) / 2)
  return `${value.slice(0, headLength)}…${value.slice(-tailLength)}`
}

function extractErrorMessage(data: unknown, rawData: string) {
  if (typeof data === "string" && data.trim()) {
    return data
  }

  if (data && typeof data === "object" && "detail" in data) {
    const detail = (data as { detail?: unknown }).detail
    if (typeof detail === "string" && detail.trim()) {
      return detail
    }
  }

  return rawData || "Stream failed"
}

function shouldPromoteMessageToTitle(title?: string | null) {
  const normalized = (title || "").trim()
  return !normalized || normalized === "New Conversation" || normalized === "Untitled Chat"
}

function deriveThreadTitle(message: string, maxLength = 80) {
  const normalized = message.replace(/\s+/g, " ").trim()
  if (!normalized) {
    return "New Conversation"
  }
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

function formatToolContent(value: string, language?: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return "No arguments"
  }

  if (!trimmed.includes("\n") && trimmed.length <= 160) {
    return trimmed
  }

  const fenceLanguage = language || inferLanguage(trimmed)
  return `\`\`\`${fenceLanguage}\n${trimmed}\n\`\`\``
}

function detectLanguage(record: Record<string, unknown>) {
  const explicit =
    firstStringValue(record, ["language", "lang", "runtime"]) ||
    firstStringValue(record, ["interpreter", "shell"])
  if (explicit) {
    return normalizeLanguage(explicit)
  }
  return undefined
}

function inferLanguage(value: string) {
  const normalized = value.trim()
  if (normalized.startsWith("python") || normalized.includes("import ") || normalized.includes("def ")) {
    return "python"
  }
  if (
    normalized.startsWith("bash") ||
    normalized.startsWith("sh ") ||
    normalized.includes("&&") ||
    normalized.includes("export ") ||
    normalized.includes("pip ")
  ) {
    return "bash"
  }
  return ""
}

function normalizeLanguage(value: string) {
  const normalized = value.trim().toLowerCase()
  if (["python", "py"].includes(normalized)) {
    return "python"
  }
  if (["bash", "sh", "shell", "zsh"].includes(normalized)) {
    return "bash"
  }
  return normalized
}

function firstStringValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) {
      return value
    }
  }
  return undefined
}

function mapPersistedMessage(
  message: ThreadMessage,
  activitiesByRun: Record<string, StreamActivity[]>,
): Message {
  return {
    id: message.message_id,
    role: message.role,
    content: message.content,
    isStreaming: message.status === "streaming",
    runId: message.run_id || undefined,
    activities: buildPersistedActivities(message, activitiesByRun),
  }
}

function buildPersistedActivities(
  message: ThreadMessage,
  activitiesByRun: Record<string, StreamActivity[]>,
): StreamActivity[] {
  if (message.role !== "assistant") {
    return []
  }

  if (message.run_id && activitiesByRun[message.run_id]?.length) {
    return activitiesByRun[message.run_id]
  }

  if (message.status === "failed") {
    return [
      {
        id: message.run_id || message.message_id,
        kind: "error",
        state: "error",
        label: "Run failed",
        detail: previewText(message.content),
      },
    ]
  }

  if (message.status === "completed" && message.run_id) {
    return [
      {
        id: message.run_id,
        kind: "status",
        state: "done",
        label: "Run completed",
      },
    ]
  }

  return []
}

function buildActivitiesByRun(events: ThreadRunEvent[]): Record<string, StreamActivity[]> {
  const eventsByRun = new Map<string, ThreadRunEvent[]>()

  for (const event of events) {
    const runEvents = eventsByRun.get(event.run_id) || []
    runEvents.push(event)
    eventsByRun.set(event.run_id, runEvents)
  }

  const activitiesByRun: Record<string, StreamActivity[]> = {}

  for (const [runId, runEvents] of eventsByRun.entries()) {
    let activities: StreamActivity[] = []
    for (const event of runEvents) {
      const activity = mapRunEventToActivity(event)
      if (!activity) {
        continue
      }
      activities = upsertActivity(activities, activity)
    }
    activitiesByRun[runId] = activities
  }

  return activitiesByRun
}

function mapRunEventToActivity(event: ThreadRunEvent): StreamActivity | null {
  if (event.event_type === "run_started") {
    return {
      id: `${event.run_id}-started`,
      kind: "metadata",
      state: "live",
      label: "Run started",
      detail: `Run ID ${truncateMiddle(event.run_id, 18)}`,
    }
  }

  if (event.event_type === "assistant_snapshot") {
    const content = typeof event.payload.content === "string" ? event.payload.content : ""
    if (!content.trim()) {
      return null
    }
    return {
      id: event.correlation_id || event.event_id,
      kind: "status",
      state: "done",
      label: "Draft response updated",
      detail: previewText(content),
    }
  }

  if (event.event_type === "tool_call") {
    return {
      id: event.correlation_id || event.event_id,
      kind: "tool_call",
      state: event.status === "error" ? "error" : "live",
      label: `Running ${event.name || "tool"}`,
      args: summarizeArgs(event.payload.args),
    }
  }

  if (event.event_type === "tool_result") {
    const content =
      typeof event.payload.content === "string"
        ? event.payload.content
        : JSON.stringify(event.payload.content, null, 2)
    return {
      id: event.correlation_id || event.event_id,
      kind: "tool_result",
      state: event.status === "error" ? "error" : "done",
      label: `${event.name || "Tool"} ${event.status === "error" ? "returned an error" : "finished"}`,
      result: content,
    }
  }

  if (event.event_type === "node_completed") {
    return {
      id: event.correlation_id || event.event_id,
      kind: "status",
      state: "done",
      label: formatNodeLabel(event.node_name || "Node"),
    }
  }

  if (event.event_type === "run_completed") {
    return {
      id: `${event.run_id}-completed`,
      kind: "status",
      state: "done",
      label: "Run completed",
    }
  }

  if (event.event_type === "run_failed") {
    const detail = typeof event.payload.detail === "string" ? event.payload.detail : "Run failed"
    return {
      id: `${event.run_id}-failed`,
      kind: "error",
      state: "error",
      label: "Run failed",
      detail,
    }
  }

  return null
}
