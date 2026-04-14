import { type StreamActivity, type StreamEnvelope, type Todo, type Message } from '../types/chat'
import { type ThreadMessage, type ThreadRunEvent } from './api-client'

export function extractStreamState(payload: unknown): StreamEnvelope {
  if (!payload || typeof payload !== 'object') {
    return {}
  }

  let content: string | undefined
  let activities: StreamActivity[] = []

  for (const [nodeName, nodeData] of Object.entries(payload as Record<string, unknown>)) {
    const isInternalNode = [
      'write_todos',
      'task',
      'plan',
      'orchestrator',
      'planner',
      'tools',
      '__start__',
      '__end__',
    ].includes(nodeName)

    if (!nodeData || typeof nodeData !== 'object') {
      continue
    }

    for (const message of extractNodeMessages(nodeData)) {
      const isAssistant = message.type === 'ai' || message.role === 'assistant'
      const messageContent = typeof message.content === 'string' ? message.content.trim() : ''

      if (isAssistant && messageContent && !isInternalNode) {
        const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0
        if (!hasToolCalls) {
          content = messageContent
        }
      }

      if ((message.type === 'ai' || message.role === 'assistant') && Array.isArray(message.tool_calls)) {
        for (const toolCall of message.tool_calls) {
          const id = toolCall.id || `${nodeName}-${toolCall.name}`
          activities = upsertActivity(activities, {
            id,
            kind: 'tool_call',
            state: 'live',
            label: `Running ${toolCall.name}`,
            args: summarizeArgs(toolCall.args),
          })
        }
      }

      if (message.type === 'tool') {
        const id = message.tool_call_id || message.id || `${nodeName}-${message.name}`
        activities = upsertActivity(activities, {
          id,
          kind: 'tool_result',
          state: message.status === 'success' ? 'done' : 'error',
          label: `${message.name} ${message.status === 'success' ? 'finished' : 'returned an error'}`,
          result: typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
        })
      }
    }
  }

  return { content, activities }
}

export function extractNodeMessages(nodeData: unknown): Array<Record<string, any>> {
  if (!nodeData || typeof nodeData !== 'object') {
    return []
  }

  const record = nodeData as Record<string, unknown>
  const messages = 'messages' in record ? record.messages : record.value

  if (Array.isArray(messages)) {
    return messages.filter((message): message is Record<string, any> => Boolean(message) && typeof message === 'object')
  }

  if (messages && typeof messages === 'object') {
    const nestedMessages = messages as Record<string, unknown>
    if (Array.isArray(nestedMessages.value)) {
      return nestedMessages.value.filter(
        (message): message is Record<string, any> => Boolean(message) && typeof message === 'object',
      )
    }
    if (nestedMessages.value && typeof nestedMessages.value === 'object') {
      return [nestedMessages.value as Record<string, any>]
    }
  }

  if (messages && typeof messages === 'object') {
    return [messages as Record<string, any>]
  }

  if ('value' in record && Array.isArray(record.value)) {
    return record.value.filter((message): message is Record<string, any> => Boolean(message) && typeof message === 'object')
  }

  return []
}

export function mergeActivities(
  existing: StreamActivity[] | undefined,
  incoming: StreamActivity[] | undefined,
): StreamActivity[] {
  let next = [...(existing || [])]
  for (const activity of incoming || []) {
    next = upsertActivity(next, activity)
  }
  return next
}

export function upsertActivity(
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

export function markActivitiesComplete(activities: StreamActivity[] | undefined): StreamActivity[] {
  return (activities || []).map((activity) =>
    activity.state === 'live' ? { ...activity, state: 'done' } : activity,
  )
}

export function summarizeArgs(args: unknown) {
  if (!args) {
    return 'No arguments'
  }

  if (typeof args === 'string') {
    return formatToolContent(args)
  }

  if (typeof args === 'object') {
    const record = args as Record<string, unknown>
    const codeValue = firstStringValue(record, ['code', 'script', 'command', 'cmd', 'source'])
    if (codeValue) {
      return formatToolContent(codeValue, detectLanguage(record))
    }
  }

  try {
    return formatToolContent(JSON.stringify(args, null, 2), 'json')
  } catch {
    return 'Arguments unavailable'
  }
}

export function previewText(value: string, limit = 160) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= limit) {
    return normalized
  }
  return `${normalized.slice(0, limit - 1)}…`
}

export function formatNodeLabel(nodeName: string) {
  return (
    nodeName
      .split('.')
      .pop()
      ?.replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .replace(/^\w/, (char) => char.toUpperCase()) || nodeName
  )
}

export function truncateMiddle(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }

  const headLength = Math.ceil((maxLength - 1) / 2)
  const tailLength = Math.floor((maxLength - 1) / 2)
  return `${value.slice(0, headLength)}…${value.slice(-tailLength)}`
}

export function extractErrorMessage(data: unknown, rawData: string) {
  if (typeof data === 'string' && data.trim()) {
    return data
  }

  if (data && typeof data === 'object' && 'detail' in data) {
    const detail = (data as { detail?: unknown }).detail
    if (typeof detail === 'string' && detail.trim()) {
      return detail
    }
  }

  return rawData || 'Stream failed'
}

export function shouldPromoteMessageToTitle(title?: string | null) {
  const normalized = (title || '').trim()
  return !normalized || normalized === 'New Conversation' || normalized === 'Untitled Chat'
}

export function deriveThreadTitle(message: string, maxLength = 80) {
  const normalized = message.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return 'New Conversation'
  }
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

export function formatToolContent(value: string, language?: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return 'No arguments'
  }

  if (!trimmed.includes('\n') && trimmed.length <= 160) {
    return trimmed
  }

  const fenceLanguage = language || inferLanguage(trimmed)
  return `\`\`\`${fenceLanguage}\n${trimmed}\n\`\`\``
}

export function detectLanguage(record: Record<string, unknown>) {
  const explicit =
    firstStringValue(record, ['language', 'lang', 'runtime']) || firstStringValue(record, ['interpreter', 'shell'])
  if (explicit) {
    return normalizeLanguage(explicit)
  }
  return undefined
}

export function inferLanguage(value: string) {
  const normalized = value.trim()
  if (normalized.startsWith('python') || normalized.includes('import ') || normalized.includes('def ')) {
    return 'python'
  }
  if (
    normalized.startsWith('bash') ||
    normalized.startsWith('sh ') ||
    normalized.includes('&&') ||
    normalized.includes('export ') ||
    normalized.includes('pip ')
  ) {
    return 'bash'
  }
  return ''
}

export function normalizeLanguage(value: string) {
  const normalized = value.trim().toLowerCase()
  if (['python', 'py'].includes(normalized)) {
    return 'python'
  }
  if (['bash', 'sh', 'shell', 'zsh'].includes(normalized)) {
    return 'bash'
  }
  return normalized
}

export function firstStringValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }
  return undefined
}

export function mapPersistedMessage(message: ThreadMessage, activitiesByRun: Record<string, StreamActivity[]>): Message {
  return {
    id: message.message_id,
    role: message.role,
    content: message.content,
    createdAt: message.created_at,
    isStreaming: message.status === 'streaming',
    runId: message.run_id || undefined,
    activities: buildPersistedActivities(message, activitiesByRun),
  }
}

export function buildPersistedActivities(
  message: ThreadMessage,
  activitiesByRun: Record<string, StreamActivity[]>,
): StreamActivity[] {
  if (message.role !== 'assistant') {
    return []
  }

  if (message.run_id && activitiesByRun[message.run_id]?.length) {
    return activitiesByRun[message.run_id]
  }

  if (message.status === 'failed') {
    return [
      {
        id: message.run_id || message.message_id,
        kind: 'error',
        state: 'error',
        label: 'Run failed',
        detail: previewText(message.content),
      },
    ]
  }

  if (message.status === 'completed' && message.run_id) {
    return [
      {
        id: message.run_id,
        kind: 'status',
        state: 'done',
        label: 'Run completed',
      },
    ]
  }

  return []
}

export function buildActivitiesByRun(events: ThreadRunEvent[]): Record<string, StreamActivity[]> {
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

export function mapRunEventToActivity(event: ThreadRunEvent): StreamActivity | null {
  if (event.event_type === 'run_started') {
    return {
      id: `${event.run_id}-started`,
      kind: 'metadata',
      state: 'live',
      label: 'Run started',
      detail: `Run ID ${truncateMiddle(event.run_id, 18)}`,
    }
  }

  if (event.event_type === 'assistant_snapshot') {
    const content = typeof event.payload.content === 'string' ? event.payload.content : ''
    if (!content.trim()) {
      return null
    }
    return {
      id: event.correlation_id || event.event_id,
      kind: 'status',
      state: 'done',
      label: 'Draft response updated',
      detail: previewText(content),
    }
  }

  if (event.event_type === 'tool_call') {
    return {
      id: event.correlation_id || event.event_id,
      kind: 'tool_call',
      state: event.status === 'error' ? 'error' : 'live',
      label: `Running ${event.name || 'tool'}`,
      args: summarizeArgs(event.payload.args),
    }
  }

  if (event.event_type === 'tool_result') {
    const content =
      typeof event.payload.content === 'string'
        ? event.payload.content
        : JSON.stringify(event.payload.content, null, 2)
    return {
      id: event.correlation_id || event.event_id,
      kind: 'tool_result',
      state: event.status === 'error' ? 'error' : 'done',
      label: `${event.name || 'Tool'} ${event.status === 'error' ? 'returned an error' : 'finished'}`,
      result: content,
    }
  }

  if (event.event_type === 'run_completed') {
    return {
      id: `${event.run_id}-completed`,
      kind: 'status',
      state: 'done',
      label: 'Run completed',
    }
  }

  if (event.event_type === 'run_failed') {
    const detail = typeof event.payload.detail === 'string' ? event.payload.detail : 'Run failed'
    return {
      id: `${event.run_id}-failed`,
      kind: 'error',
      state: 'error',
      label: 'Run failed',
      detail,
    }
  }

  return null
}

export function getLatestTodos(messages: Message[]): Todo[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role === 'assistant' && message.activities) {
      const todoActivity = [...message.activities].reverse().find((a) => a.label.includes('write_todos') && a.args)
      if (todoActivity && todoActivity.args) {
        return parseTodos(todoActivity.args)
      }
    }
  }
  return []
}

export function parseTodos(args: string): Todo[] {
  try {
    const jsonMatch = args.match(/```(?:json)?\s*([\s\S]*?)```/)
    const raw = jsonMatch ? jsonMatch[1] : args
    const parsed = JSON.parse(raw)
    const todos = Array.isArray(parsed) ? parsed : parsed.todos
    if (Array.isArray(todos)) {
      return todos.map((t: any) => ({
        content: t.content || t.task || t.description || 'Unknown Task',
        status: t.status || 'pending',
      }))
    }
  } catch (err) {
    console.error('Failed to parse todos:', err)
  }
  return []
}
