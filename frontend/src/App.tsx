import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { ChatArea } from "@/components/chat-area"
import { LoginScreen } from "@/components/login-screen"
import { Sidebar } from "@/components/sidebar"
import { SidePanel } from "@/components/side-panel"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { authApi, threadsApi } from "@/lib/api-client"
import { useStore } from "@/store/use-store"

const queryClient = new QueryClient()

function MainLayout() {
  useKeyboardShortcuts()

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background font-sans text-foreground">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <ChatArea />
      </main>
      <SidePanel />
    </div>
  )
}

function BootstrappedApp() {
  const { currentUser, setCurrentUser, setThreads, activeThreadId, setActiveThreadId, resetWorkspace } = useStore()
  const [isBootstrapping, setIsBootstrapping] = useState(true)

  const bootstrapSession = async () => {
    setIsBootstrapping(true)
    try {
      const me = await authApi.me()
      setCurrentUser(me.user)
      const data = await threadsApi.list()
      setThreads(data.threads)
      if (data.threads.length === 0) {
        setActiveThreadId(null)
      } else if (!activeThreadId || !data.threads.some((thread) => thread.thread_id === activeThreadId)) {
        setActiveThreadId(data.threads[0].thread_id)
      }
    } catch {
      resetWorkspace()
    } finally {
      setIsBootstrapping(false)
    }
  }

  useEffect(() => {
    void bootstrapSession()
  }, [])

  if (isBootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-sm font-semibold text-slate-500">Initializing workspace…</div>
      </div>
    )
  }

  if (!currentUser) {
    return <LoginScreen onAuthenticated={bootstrapSession} />
  }

  return <MainLayout />
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BootstrappedApp />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

export default App
