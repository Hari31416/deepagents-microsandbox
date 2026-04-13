import { create } from "zustand"
import type { Thread, ThreadFile } from "@/lib/api-client"

interface AppState {
  threads: Thread[]
  activeThreadId: string | null
  threadFiles: Record<string, ThreadFile[]>
  isSidebarOpen: boolean
  
  setThreads: (threads: Thread[]) => void
  setActiveThreadId: (id: string | null) => void
  setThreadFiles: (threadId: string, files: ThreadFile[]) => void
  toggleSidebar: () => void
}

export const useStore = create<AppState>((set) => ({
  threads: [],
  activeThreadId: null,
  threadFiles: {},
  isSidebarOpen: true,

  setThreads: (threads) => set({ threads }),
  setActiveThreadId: (activeThreadId) => set({ activeThreadId }),
  setThreadFiles: (threadId, files) => 
    set((state) => ({ 
      threadFiles: { ...state.threadFiles, [threadId]: files } 
    })),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
}))
