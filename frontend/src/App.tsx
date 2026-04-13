import { useEffect } from "react"
import { Sidebar } from "@/components/sidebar"
import { ChatArea } from "@/components/chat-area"
import { SidePanel } from "@/components/side-panel"
import { useStore } from "@/store/use-store"
import { threadsApi } from "@/lib/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@/components/ui/tooltip"

const queryClient = new QueryClient()

function MainLayout() {
  const { setThreads, activeThreadId, setActiveThreadId } = useStore()

  useEffect(() => {
    threadsApi.list().then((data) => {
      setThreads(data.threads)
      if (data.threads.length > 0 && !activeThreadId) {
        setActiveThreadId(data.threads[0].thread_id)
      }
    }).catch(err => console.error("Failed to fetch threads:", err))
  }, [])

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden font-sans text-foreground">
      <Sidebar />
      <main className="flex-1 flex flex-col relative min-w-0">
        <ChatArea />
      </main>
      <SidePanel />
    </div>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MainLayout />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

export default App
