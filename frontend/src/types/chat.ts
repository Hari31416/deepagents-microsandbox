export interface Todo {
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
}

export interface StreamActivity {
  id: string
  label: string
  detail?: string
  kind: 'metadata' | 'tool_call' | 'tool_result' | 'status' | 'error'
  state: 'live' | 'done' | 'error'
  args?: string
  result?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  runId?: string
  activities?: StreamActivity[]
}

export interface StreamEnvelope {
  content?: string
  activities?: StreamActivity[]
  runId?: string
  isStreaming?: boolean
}
