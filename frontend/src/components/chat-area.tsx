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
} from "lucide-react"
import ReactMarkdown from "react-markdown"

interface StreamActivity {
  id: string
  label: string
  detail?: string
  kind: "metadata" | "tool_call" | "tool_result" | "status" | "error"
  state: "live" | "done" | "error"
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [activeMessages])

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
          updateAssistantMessage(threadId, assistantMsgId, (message) => ({
            content: streamState.content ?? message.content,
            activities: mergeActivities(message.activities, streamState.activities),
          }))
          continue
        }

        if (event.event === "error") {
          const detail = extractErrorMessage(event.data, event.rawData)
          updateAssistantMessage(threadId, assistantMsgId, (message) => ({
            content: message.content ? `${message.content}\n\n${detail}` : detail,
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

        if (event.event === "message" || event.event === "delta") {
          const delta = typeof event.data === "string" ? event.data : event.data?.delta || event.rawData
          if (!delta) {
            continue
          }

          updateAssistantMessage(threadId, assistantMsgId, (message) => ({
            content: `${message.content}${delta}`,
          }))
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
    <div className="flex-1 flex flex-col h-full bg-slate-50/50 dark:bg-[#0b0c10]/50 relative">
      <header className="h-14 border-b border-border bg-background/80 backdrop-blur-sm px-6 flex items-center justify-between sticky top-0 z-10">
        <div className="flex flex-col min-w-0">
          <h2 className="text-sm font-semibold truncate">{activeThread?.title || "Untitled Conversation"}</h2>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400">Thread ID: {activeThreadId}</span>
            <Badge
              variant="outline"
              className="text-[9px] h-4 py-0 px-1 font-normal uppercase tracking-wider bg-slate-100/50"
            >
              Active
            </Badge>
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
          {activeMessages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex gap-4",
                message.role === "assistant"
                  ? "bg-white/60 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-[0_20px_60px_-45px_rgba(15,23,42,0.7)]"
                  : "",
              )}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                  message.role === "assistant" ? "bg-slate-900 text-white" : "bg-white border border-border",
                )}
              >
                {message.role === "assistant" ? <Bot className="h-5 w-5" /> : <UserIcon className="h-4 w-4" />}
              </div>
              <div className="flex-1 min-w-0 space-y-3">
                <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  {message.role === "assistant" ? "AI Agent" : "You"}
                </div>

                {message.role === "assistant" && (
                  <LiveTrace
                    activities={message.activities || []}
                    runId={message.runId}
                    isStreaming={Boolean(message.isStreaming)}
                  />
                )}

                <div className="prose prose-sm prose-slate dark:prose-invert max-w-none">
                  <ReactMarkdown>{message.content || (message.isStreaming ? "_Thinking..._" : "")}</ReactMarkdown>
                  {message.isStreaming && <Loader2 className="h-4 w-4 animate-spin text-slate-400 mt-2" />}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} className="h-4" />
        </div>
      </ScrollArea>

      <div className="p-6 max-w-3xl mx-auto w-full sticky bottom-0">
        <ChatInput onSend={handleSendMessage} disabled={isStreaming || isHydratingHistory} />
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
  if (!runId && activities.length === 0 && !isStreaming) {
    return null
  }

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-[linear-gradient(135deg,rgba(248,250,252,0.98),rgba(241,245,249,0.84))] px-3 py-3 shadow-[0_20px_40px_-32px_rgba(15,23,42,0.9)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-slate-500 font-semibold">
          <Radio className={cn("h-3.5 w-3.5", isStreaming && "animate-pulse text-emerald-600")} />
          Live Trace
        </div>
        {runId ? (
          <div className="text-[10px] text-slate-500 font-medium">Run {truncateMiddle(runId, 18)}</div>
        ) : null}
      </div>

      <div className="mt-3 space-y-2">
        {activities.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500">
            Waiting for the first streaming update...
          </div>
        ) : (
          activities.map((activity) => (
            <div
              key={activity.id}
              className={cn(
                "flex items-start gap-3 rounded-xl border px-3 py-2 transition-colors",
                activity.state === "error"
                  ? "border-rose-200 bg-rose-50/80"
                  : activity.state === "done"
                    ? "border-emerald-200 bg-emerald-50/70"
                    : "border-slate-200 bg-white/70",
              )}
            >
              <div className="mt-0.5 shrink-0">{getActivityIcon(activity)}</div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-800">{activity.label}</div>
                {activity.detail ? (
                  <div className="mt-1 text-[11px] leading-5 text-slate-500 break-words prose prose-xs prose-slate max-w-none">
                    <ReactMarkdown>{activity.detail}</ReactMarkdown>
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
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
      if ((message.type === "ai" || message.role === "assistant") && typeof message.content === "string" && message.content.trim()) {
        content = message.content
        activities = upsertActivity(activities, {
          id: message.id || `${nodeName}-assistant`,
          kind: "status",
          state: "done",
          label: "Draft response updated",
          detail: previewText(message.content),
        })
      }

      if ((message.type === "ai" || message.role === "assistant") && Array.isArray(message.tool_calls)) {
        for (const toolCall of message.tool_calls) {
          activities = upsertActivity(activities, {
            id: toolCall.id || `${nodeName}-${toolCall.name}`,
            kind: "tool_call",
            state: "live",
            label: `Running ${toolCall.name}`,
            detail: summarizeArgs(toolCall.args),
          })
        }
      }

      if (message.type === "tool") {
        activities = upsertActivity(activities, {
          id: message.tool_call_id || message.id || `${nodeName}-${message.name}`,
          kind: "tool_result",
          state: message.status === "success" ? "done" : "error",
          label: `${message.name} ${message.status === "success" ? "finished" : "returned an error"}`,
          detail: previewText(typeof message.content === "string" ? message.content : JSON.stringify(message.content)),
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
      detail: summarizeArgs(event.payload.args),
    }
  }

  if (event.event_type === "tool_result") {
    const content =
      typeof event.payload.content === "string"
        ? formatToolContent(event.payload.content)
        : formatToolContent(JSON.stringify(event.payload.content, null, 2), "json")
    return {
      id: event.correlation_id || event.event_id,
      kind: "tool_result",
      state: event.status === "error" ? "error" : "done",
      label: `${event.name || "Tool"} ${event.status === "error" ? "returned an error" : "finished"}`,
      detail: previewText(content),
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
