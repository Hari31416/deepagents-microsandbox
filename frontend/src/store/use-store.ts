import { create } from "zustand"
import type { AuthUser, Thread, ThreadFile } from "@/lib/api-client"

interface AppState {
  currentUser: AuthUser | null
  threads: Thread[]
  activeThreadId: string | null
  threadFiles: Record<string, ThreadFile[]>
  isSidebarOpen: boolean
  isWorkspaceOpen: boolean
  selectedFile: ThreadFile | null
  
  setCurrentUser: (user: AuthUser | null) => void
  setThreads: (threads: Thread[]) => void
  setActiveThreadId: (id: string | null) => void
  setThreadFiles: (threadId: string, files: ThreadFile[]) => void
  updateThreadTitle: (threadId: string, title: string) => void
  removeThread: (threadId: string) => void
  toggleSidebar: () => void
  toggleWorkspace: () => void
  setSelectedFile: (file: ThreadFile | null) => void
  resetWorkspace: () => void
}

export const useStore = create<AppState>((set) => ({
  currentUser: null,
  threads: [],
  activeThreadId: null,
  threadFiles: {},
  isSidebarOpen: true,
  isWorkspaceOpen: true,
  selectedFile: null,
  
  setCurrentUser: (currentUser) => set({ currentUser }),
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
  removeThread: (threadId) =>
    set((state) => {
      const nextThreadFiles = { ...state.threadFiles }
      delete nextThreadFiles[threadId]
      return {
        threads: state.threads.filter((thread) => thread.thread_id !== threadId),
        threadFiles: nextThreadFiles,
        selectedFile: state.selectedFile?.thread_id === threadId ? null : state.selectedFile,
      }
  }),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  toggleWorkspace: () => set((state) => ({ isWorkspaceOpen: !state.isWorkspaceOpen })),
  setSelectedFile: (selectedFile) => set({ selectedFile }),
  resetWorkspace: () =>
    set({
      threads: [],
      activeThreadId: null,
      threadFiles: {},
      selectedFile: null,
      currentUser: null,
    }),
}))
