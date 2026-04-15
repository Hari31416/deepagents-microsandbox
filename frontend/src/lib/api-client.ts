import axios from "axios"

const DEFAULT_API_BASE_URL = "http://localhost:8000/api"
const API_BASE_URL = normalizeApiBaseUrl(
  import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL,
)

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
})

function normalizeApiBaseUrl(rawValue: string): string {
  const trimmed = rawValue.trim()
  if (!trimmed) {
    return DEFAULT_API_BASE_URL
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed.replace(/\/+$/, "")
  }
  if (trimmed.startsWith("/")) {
    return new URL(trimmed, window.location.origin).toString().replace(/\/+$/, "")
  }
  return `http://${trimmed}`.replace(/\/+$/, "")
}

export interface AuthUser {
  user_id: string
  email: string
  display_name?: string | null
  role: "super_admin" | "admin" | "user"
  status: "active" | "disabled"
  created_by?: string | null
  is_seeded: boolean
  created_at: string
  updated_at: string
  last_login_at?: string | null
}

export interface Thread {
  thread_id: string
  owner_id: string
  title?: string
  created_at: string
}

export interface ThreadFile {
  file_id: string
  thread_id: string
  object_key?: string
  original_filename: string
  content_type: string
  size: number
  purpose: "upload" | "artifact"
  status: string
  created_at: string
}

export interface ThreadMessage {
  message_id: string
  thread_id: string
  owner_id: string
  role: "user" | "assistant"
  content: string
  status: "streaming" | "completed" | "failed"
  run_id?: string | null
  created_at: string
  updated_at: string
}

export interface ThreadRunEvent {
  event_id: string
  run_id: string
  thread_id: string
  owner_id: string
  sequence: number
  event_type: string
  name?: string | null
  node_name?: string | null
  correlation_id?: string | null
  status?: string | null
  payload: Record<string, unknown>
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

export const authApi = {
  me: () => apiClient.get<{ user: AuthUser }>("/auth/me").then((r) => r.data),
  login: (email: string, password: string) =>
    apiClient.post<{ user: AuthUser }>("/auth/login", { email, password }).then((r) => r.data),
  refresh: () => apiClient.post<{ user: AuthUser }>("/auth/refresh").then((r) => r.data),
  logout: () => apiClient.post("/auth/logout").then((r) => r.data),
}

export const adminUsersApi = {
  list: () => apiClient.get<{ users: AuthUser[] }>("/admin/users").then((r) => r.data),
  create: (payload: { email: string; password: string; display_name?: string | null; role: AuthUser["role"] }) =>
    apiClient.post<AuthUser>("/admin/users", payload).then((r) => r.data),
  update: (userId: string, payload: { display_name?: string | null; role?: AuthUser["role"] | null; status?: AuthUser["status"] | null }) =>
    apiClient.patch<AuthUser>(`/admin/users/${userId}`, payload).then((r) => r.data),
  resetPassword: (userId: string, password: string) =>
    apiClient.post<AuthUser>(`/admin/users/${userId}/reset-password`, { password }).then((r) => r.data),
}

export const threadsApi = {
  list: () => apiClient.get<{ threads: Thread[] }>("/threads").then((r) => r.data),
  create: (title?: string) => apiClient.post<Thread>("/threads", { title }).then((r) => r.data),
  get: (id: string) => apiClient.get<Thread>(`/threads/${id}`).then((r) => r.data),
  update: (id: string, title?: string | null) => apiClient.patch<Thread>(`/threads/${id}`, { title }).then((r) => r.data),
  delete: (id: string) => apiClient.delete(`/threads/${id}`).then((r) => r.data),
  getMessages: (id: string) => apiClient.get<{ messages: ThreadMessage[] }>(`/threads/${id}/messages`).then((r) => r.data),
  getEvents: (id: string, params?: { run_id?: string }) =>
    apiClient.get<{ events: ThreadRunEvent[] }>(`/threads/${id}/events`, { params }).then((r) => r.data),
  getFiles: (id: string) => apiClient.get<{ files: ThreadFile[] }>(`/threads/${id}/files`).then((r) => r.data),
}

export const filesApi = {
  upload: async (params: {
    thread_id: string
    file: File
    purpose: "upload"
  }) => {
    const uploadUrl = new URL(`${API_BASE_URL}/files/upload`)
    uploadUrl.searchParams.set("thread_id", params.thread_id)
    uploadUrl.searchParams.set("filename", params.file.name)
    uploadUrl.searchParams.set("purpose", params.purpose)
    const response = await fetch(uploadUrl.toString(), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": params.file.type || "application/octet-stream",
      },
      body: params.file,
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Upload failed" }))
      throw new Error(error.detail || "Upload failed")
    }
    return (await response.json()) as ThreadFile
  },

  presignUpload: (params: {
    thread_id: string
    filename: string
    content_type: string
    size: number
    purpose: "upload"
  }) => apiClient.post<PresignedUpload>("/files/presign-upload", params).then((r) => r.data),

  completeUpload: (params: {
    thread_id: string
    file_id: string
  }) => apiClient.post<ThreadFile>("/files/complete-upload", params).then((r) => r.data),

  presignDownload: (params: {
    thread_id: string
    file_id: string
  }) => apiClient.post<PresignedDownload>("/files/presign-download", params).then((r) => r.data),

  getViewUrl: (threadId: string, fileId: string) => `${API_BASE_URL}/files/${threadId}/${fileId}`,
  getDownloadUrl: (threadId: string, fileId: string) => `${API_BASE_URL}/files/${threadId}/${fileId}/download`,
}

export interface SseEvent {
  event: string
  id?: string
  data: any
  rawData: string
}

export async function* streamChat(params: {
  thread_id: string
  message: string
  selected_file_ids: string[]
}) {
  const response = await fetch(`${API_BASE_URL}/chat/stream`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
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
  let currentEventName = "message"
  let currentEventId: string | undefined
  let currentDataLines: string[] = []

  const flushEvent = (): SseEvent | null => {
    if (!currentDataLines.length && !currentEventId && currentEventName === "message") {
      return null
    }

    const rawData = currentDataLines.join("\n")
    let parsedData: unknown = rawData

    if (rawData) {
      try {
        parsedData = JSON.parse(rawData)
      } catch {
        parsedData = rawData
      }
    }

    const event: SseEvent = {
      event: currentEventName || "message",
      id: currentEventId,
      data: parsedData,
      rawData,
    }

    currentEventName = "message"
    currentEventId = undefined
    currentDataLines = []

    return event
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ""

    for (const line of lines) {
      if (!line) {
        const event = flushEvent()
        if (event) {
          yield event
        }
        continue
      }

      if (line.startsWith(":")) {
        continue
      }

      const separatorIndex = line.indexOf(":")
      const key = separatorIndex === -1 ? line : line.slice(0, separatorIndex)
      const rawValue = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1)
      const valueText = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue

      if (key === "event") {
        currentEventName = valueText || "message"
      } else if (key === "id") {
        currentEventId = valueText
      } else if (key === "data") {
        currentDataLines.push(valueText)
      }
    }
  }

  if (buffer) {
    const trailingLine = buffer.replace(/\r$/, "")
    if (trailingLine.startsWith("data:")) {
      const rawValue = trailingLine.slice(5)
      currentDataLines.push(rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue)
    }
  }

  const finalEvent = flushEvent()
  if (finalEvent) {
    yield finalEvent
  }
}
