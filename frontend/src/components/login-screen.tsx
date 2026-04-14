import { useState } from "react"
import { Loader2, LockKeyhole, Terminal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { authApi } from "@/lib/api-client"

interface LoginScreenProps {
  onAuthenticated: () => Promise<void> | void
}

export function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      await authApi.login(email, password)
      await onAuthenticated()
    } catch (err) {
      const detail =
        err instanceof Error
          ? err.message
          : "Authentication failed. Check your credentials and try again."
      setError(detail)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.12),_transparent_40%),linear-gradient(135deg,#f8fafc_0%,#e2e8f0_100%)] px-6 py-10 text-slate-900">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl items-center justify-center">
        <div className="grid w-full gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[2rem] border border-slate-200/70 bg-white/70 p-10 shadow-2xl shadow-slate-900/5 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-900/10">
                <Terminal className="h-6 w-6" />
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-[0.28em] text-slate-500">DeepAgent Sandbox</div>
                <h1 className="mt-2 text-4xl font-black tracking-tight">Authenticated analysis with role-aware access.</h1>
              </div>
            </div>

            <div className="mt-10 grid gap-4 text-sm text-slate-600 sm:grid-cols-3">
              <Card className="rounded-2xl border-slate-200/80 bg-white/80 p-5 shadow-none">
                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Threads</div>
                <p className="mt-2 font-semibold text-slate-900">Per-user sessions and resumable runs.</p>
              </Card>
              <Card className="rounded-2xl border-slate-200/80 bg-white/80 p-5 shadow-none">
                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">RBAC</div>
                <p className="mt-2 font-semibold text-slate-900">Super admins, admins, and users with enforced permissions.</p>
              </Card>
              <Card className="rounded-2xl border-slate-200/80 bg-white/80 p-5 shadow-none">
                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Sandbox</div>
                <p className="mt-2 font-semibold text-slate-900">Thread-scoped execution backed by DeepAgents.</p>
              </Card>
            </div>
          </div>

          <Card className="rounded-[2rem] border-slate-200/80 bg-white/90 p-8 shadow-2xl shadow-slate-900/10">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <LockKeyhole className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">Sign In</div>
                <p className="mt-1 text-sm text-slate-500">Use a seeded super admin or an account created through the admin panel.</p>
              </div>
            </div>

            <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="superadmin@deepagent.local"
                  autoComplete="email"
                  required
                  className="h-12 rounded-xl border-slate-200 bg-slate-50/70"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Password</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                  className="h-12 rounded-xl border-slate-200 bg-slate-50/70"
                />
              </div>

              {error ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <Button className="h-12 w-full rounded-xl text-xs font-black uppercase tracking-[0.24em]" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Access Workspace"}
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  )
}
