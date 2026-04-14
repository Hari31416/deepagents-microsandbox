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
    <div className="relative min-h-screen overflow-hidden bg-[#f8fafc] px-6 py-10 font-sans text-slate-900 selection:bg-primary/30">
      {/* Simple, Clean Background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_#e2e8f0_0%,_transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,_#f1f5f9_0%,_transparent_50%)]" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <Card className="grid w-full overflow-hidden rounded-[2.5rem] border-slate-200 bg-white shadow-2xl shadow-slate-200/50 lg:grid-cols-[1fr_0.9fr]">
          {/* Left Side: Branding & Features */}
          <div className="relative flex flex-col justify-between border-r border-slate-100 bg-slate-50 p-12 text-slate-900">
            <div className="relative z-10">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-950 text-white shadow-lg">
                  <Terminal className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.3em] text-slate-500">DeepAgent</div>
                  <h1 className="text-xl font-black tracking-tight text-slate-900">Sandbox</h1>
                </div>
              </div>

              <div className="mt-16">
                <h2 className="text-4xl font-extrabold leading-[1.1] tracking-tight text-slate-900 lg:text-5xl">
                  Where data meets <span className="text-primary">intelligence.</span>
                </h2>
                <p className="mt-6 max-w-md text-lg leading-relaxed text-slate-500">
                  Your secure environment for advanced AI analysis, secure execution, and real-time insights.
                </p>
              </div>
            </div>

            <div className="mt-12 space-y-4 text-sm text-slate-600">
              <div className="flex items-start gap-4 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-900">
                  <LockKeyhole className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-bold text-slate-900">Role-Aware Access</div>
                  <p className="mt-1">Enterprise-grade security with granular permissions.</p>
                </div>
              </div>
              <div className="flex items-start gap-4 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-900">
                  <Terminal className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-bold text-slate-900">Isolated Execution</div>
                  <p className="mt-1">Secure sandboxes for thread-scoped AI workflows.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Side: Login Form */}
          <div className="flex flex-col justify-center bg-white p-12 lg:p-16">
            <div className="mb-8">
              <h3 className="text-2xl font-bold text-slate-900">Sign in</h3>
              <p className="mt-2 text-slate-500">Welcome back! Please enter your details.</p>
            </div>

            <form className="space-y-6" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Email Address</label>
                <div className="relative">
                  <Input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="admin@example.com"
                    autoComplete="email"
                    required
                    className="h-13 rounded-2xl border-slate-200 bg-slate-50/50 px-4 py-6 transition-all focus:bg-white focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Password</label>
                  <button type="button" className="text-xs font-bold text-primary hover:underline">Forgot?</button>
                </div>
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  required
                  className="h-13 rounded-2xl border-slate-200 bg-slate-50/50 px-4 py-6 transition-all focus:bg-white focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {error ? (
                <div className="animate-in fade-in slide-in-from-top-2 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
                  {error}
                </div>
              ) : null}

              <Button
                className="relative h-14 w-full overflow-hidden rounded-2xl bg-primary text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    Enter Dashboard
                  </span>
                )}
                {/* Glow Effect */}
                <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-500 group-hover:translate-x-full" />
              </Button>
            </form>

          </div>
        </Card>
      </div>
    </div>
  )
}
