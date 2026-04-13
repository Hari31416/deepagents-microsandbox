import axios from "axios"

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api"
const DEFAULT_USER_ID = import.meta.env.VITE_DEFAULT_USER_ID || "dev-user-123"

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
    "X-User-Id": DEFAULT_USER_ID,
  },
})

// Types from handoff
export interface Thread {
  thread_id: string
  owner_id: string
  title?: string
  created_at: string
}

export interface ThreadFile {
  file_id: string
  thread_id: string
  object_key: string
  original_filename: string
  content_type: string
  size: number
  purpose: "upload" | "artifact"
  status: string
  created_at: string
}

export interface PresignedUpload {
  file_id: string
  thread_id: string
  object_key: string
  url: string
  required_headers: Record<string, string>
  expires_at: string
  content_type: string
  size: number
}

export interface PresignedDownload {
  thread_id: string
  object_key: string
  url: string
  required_headers: Record<string, string>
  expires_at: string
}

export const threadsApi = {
  list: () => apiClient.get<{ threads: Thread[] }>("/threads").then((r) => r.data),
  create: (title?: string) => apiClient.post<Thread>("/threads", { title }).then((r) => r.data),
  get: (id: string) => apiClient.get<Thread>(`/threads/${id}`).then((r) => r.data),
  getFiles: (id: string) => apiClient.get<{ files: ThreadFile[] }>(`/threads/${id}/files`).then((r) => r.data),
}

export const filesApi = {
  presignUpload: (params: {
    thread_id: string
    filename: string
    content_type: string
    size: number
    purpose: "upload"
  }) => apiClient.post<PresignedUpload>("/files/presign-upload", params).then((r) => r.data),

  completeUpload: (params: {
    thread_id: string
    object_key: string
    original_filename: string
    content_type: string
    size: number
    purpose: "upload"
  }) => apiClient.post<ThreadFile>("/files/complete-upload", params).then((r) => r.data),

  presignDownload: (params: {
    thread_id: string
    file_id?: string
    object_key?: string
  }) => apiClient.post<PresignedDownload>("/files/presign-download", params).then((r) => r.data),
}

// SSE Parser
export interface SseEvent {
  event: string
  data: any
}

export async function* streamChat(params: {
  thread_id: string
  message: string
  selected_file_ids: string[]
}) {
  const response = await fetch(`${API_BASE_URL}/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": DEFAULT_USER_ID,
    },
    body: JSON.stringify(params),
  })

  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({ detail: "Unknown error" }))
    throw new Error(error.detail || "Failed to start stream")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    let currentEvent: Partial<SseEvent> = {}

    for (const line of lines) {
      if (!line.trim()) {
        if (currentEvent.event && currentEvent.data) {
          yield currentEvent as SseEvent
          currentEvent = {}
        }
        continue
      }

      const [key, ...rest] = line.split(":")
      const val = rest.join(":").trim()

      if (key === "event") {
        currentEvent.event = val
      } else if (key === "data") {
        try {
          currentEvent.data = JSON.parse(val)
        } catch {
          currentEvent.data = val
        }
      }
    }
  }
}
