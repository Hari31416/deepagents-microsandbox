import { create } from "zustand"
import type { Thread, ThreadFile } from "@/lib/api-client"

interface AppState {
  threads: Thread[]
  activeThreadId: string | null
  threadFiles: Record<string, ThreadFile[]>
  isSidebarOpen: boolean
  isWorkspaceOpen: boolean
  
  setThreads: (threads: Thread[]) => void
  setActiveThreadId: (id: string | null) => void
  setThreadFiles: (threadId: string, files: ThreadFile[]) => void
  updateThreadTitle: (threadId: string, title: string) => void
  toggleSidebar: () => void
  toggleWorkspace: () => void
}

export const useStore = create<AppState>((set) => ({
  threads: [],
  activeThreadId: null,
  threadFiles: {},
  isSidebarOpen: true,
  isWorkspaceOpen: true,

  setThreads: (threads) => set({ threads }),
  setActiveThreadId: (activeThreadId) => set({ activeThreadId }),
  setThreadFiles: (threadId, files) => 
    set((state) => ({ 
      threadFiles: { ...state.threadFiles, [threadId]: files } 
    })),
  updateThreadTitle: (threadId, title) =>
    set((state) => ({
      threads: state.threads.map((thread) =>
        thread.thread_id === threadId ? { ...thread, title } : thread,
      ),
    })),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  toggleWorkspace: () => set((state) => ({ isWorkspaceOpen: !state.isWorkspaceOpen })),
}))
