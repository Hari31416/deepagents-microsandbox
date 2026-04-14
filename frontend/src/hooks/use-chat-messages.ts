import { useEffect, useState } from 'react'
import { useStore } from '@/store/use-store'
import { streamChat, threadsApi } from '@/lib/api-client'
import { type Message, type StreamEnvelope } from '../types/chat'
import {
  buildActivitiesByRun,
  deriveThreadTitle,
  extractErrorMessage,
  extractStreamState,
  mapPersistedMessage,
  markActivitiesComplete,
  mergeActivities,
  shouldPromoteMessageToTitle,
  truncateMiddle,
  upsertActivity,
} from '../lib/chat-utils'

export function useChatMessages(activeThreadId: string | null) {
  const { threads, updateThreadTitle, setThreadFiles } = useStore()
  const [messages, setMessages] = useState<Record<string, Message[]>>({})
  const [isStreaming, setIsStreaming] = useState(false)
  const [isHydratingHistory, setIsHydratingHistory] = useState(false)

  const activeMessages = activeThreadId ? messages[activeThreadId] || [] : []

  useEffect(() => {
    if (!activeThreadId) return

    let isCancelled = false
    setIsHydratingHistory(true)

    Promise.all([threadsApi.getMessages(activeThreadId), threadsApi.getEvents(activeThreadId)])
      .then(([messageData, eventData]) => {
        if (isCancelled) return
        const activitiesByRun = buildActivitiesByRun(eventData.events)
        setMessages((prev) => ({
          ...prev,
          [activeThreadId]: messageData.messages.map((message) => mapPersistedMessage(message, activitiesByRun)),
        }))
      })
      .catch((error) => {
        if (!isCancelled) {
          console.error('Failed to fetch thread history:', error)
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
        const nextPatch = typeof patch === 'function' ? patch(message) : patch
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
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    }
    const assistantMsgId = Math.random().toString(36).substring(7)
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
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

      let hasStartedResponding = false

      for await (const event of stream) {
        if (!hasStartedResponding) {
          hasStartedResponding = true
          updateAssistantMessage(threadId, assistantMsgId, () => ({
            createdAt: new Date().toISOString(),
          }))
        }

        if (event.event === 'metadata') {
          const runId = typeof event.data === 'object' && event.data ? String(event.data.run_id || '') : ''
          updateAssistantMessage(threadId, assistantMsgId, (message) => ({
            runId: runId || message.runId,
            activities: upsertActivity(message.activities, {
              id: runId || event.id || 'run-metadata',
              kind: 'metadata',
              state: 'live',
              label: 'Run started',
              detail: runId ? `Run ID ${truncateMiddle(runId, 18)}` : 'Streaming response connected',
            }),
          }))
          continue
        }

        if (event.event === 'updates') {
          const streamState = extractStreamState(event.data)
          updateAssistantMessage(threadId, assistantMsgId, (message) => {
            const updateContent = streamState.content || ''
            return {
              content: updateContent || message.content,
              activities: mergeActivities(message.activities, streamState.activities),
            }
          })
          continue
        }

        if (event.event === 'message' || event.event === 'delta') {
          const deltaData = typeof event.data === 'string' ? { delta: event.data } : event.data
          const delta = deltaData?.delta || ''
          const metadata = deltaData?.metadata || {}
          const node = deltaData?.node_name || metadata?.langgraph_node || ''
          const internalNodes = ['tools', 'task', 'write_todos', 'planner', 'orchestrator', 'plan', 'thought', '__start__', '__end__']
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

        if (event.event === 'error') {
          const detail = extractErrorMessage(event.data, event.rawData)
          updateAssistantMessage(threadId, assistantMsgId, (message) => ({
            content: message.content ? `${message.content}\n\n${detail}` : detail,
            isStreaming: false,
            activities: upsertActivity(message.activities, {
              id: event.id || 'stream-error',
              kind: 'error',
              state: 'error',
              label: 'Run failed',
              detail,
            }),
          }))
          continue
        }

        if (event.event === 'done') {
          threadsApi
            .getFiles(threadId)
            .then((data) => {
              setThreadFiles(threadId, data.files)
            })
            .catch((error) => {
              console.error('Failed to refresh files:', error)
            })
          updateAssistantMessage(threadId, assistantMsgId, (message) => ({
            isStreaming: false,
            activities: upsertActivity(message.activities, {
              id: event.id || 'run-done',
              kind: 'status',
              state: 'done',
              label: 'Run completed',
            }),
          }))
        }
      }

      updateAssistantMessage(threadId, assistantMsgId, (message) => ({
        isStreaming: false,
        activities: markActivitiesComplete(message.activities),
      }))
    } catch (error) {
      console.error('Streaming error:', error)
      const detail = error instanceof Error ? error.message : 'Connection lost'
      updateAssistantMessage(threadId, assistantMsgId, (message) => ({
        content: message.content ? `${message.content}\n\n[Error: ${detail}]` : `[Error: ${detail}]`,
        isStreaming: false,
        activities: upsertActivity(message.activities, {
          id: 'stream-connection-error',
          kind: 'error',
          state: 'error',
          label: 'Connection lost',
          detail,
        }),
      }))
    } finally {
      setIsStreaming(false)
    }
  }

  return {
    activeMessages,
    isStreaming,
    isHydratingHistory,
    handleSendMessage,
  }
}
