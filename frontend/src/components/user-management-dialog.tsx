import { useEffect, useMemo, useState } from "react"
import { KeyRound, RefreshCw, ShieldPlus, UserCog } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { adminUsersApi, type AuthUser } from "@/lib/api-client"

interface UserManagementDialogProps {
  currentUser: AuthUser
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserManagementDialog({ currentUser, open, onOpenChange }: UserManagementDialogProps) {
  const [users, setUsers] = useState<AuthUser[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    email: "",
    display_name: "",
    password: "",
    role: "user" as AuthUser["role"],
  })

  const allowedRoles = useMemo(
    () => (currentUser.role === "super_admin" ? (["user", "admin"] as const) : (["user"] as const)),
    [currentUser.role],
  )

  const loadUsers = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await adminUsersApi.list()
      setUsers(data.users)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      void loadUsers()
    }
  }, [open])

  const handleCreateUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsLoading(true)
    setError(null)
    try {
      const created = await adminUsersApi.create({
        email: form.email,
        display_name: form.display_name || null,
        password: form.password,
        role: form.role,
      })
      setUsers((current) => [...current, created])
      setForm({ email: "", display_name: "", password: "", role: "user" })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user")
    } finally {
      setIsLoading(false)
    }
  }

  const toggleStatus = async (user: AuthUser) => {
    const nextStatus = user.status === "active" ? "disabled" : "active"
    try {
      const updated = await adminUsersApi.update(user.user_id, { status: nextStatus })
      setUsers((current) => current.map((entry) => (entry.user_id === updated.user_id ? updated : entry)))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user")
    }
  }

  const handleResetPassword = async (user: AuthUser) => {
    const password = window.prompt(`Set a temporary password for ${user.email}`)
    if (!password) {
      return
    }
    try {
      const updated = await adminUsersApi.resetPassword(user.user_id, password)
      setUsers((current) => current.map((entry) => (entry.user_id === updated.user_id ? updated : entry)))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-5xl overflow-hidden rounded-[2rem] border-slate-200 bg-white p-0">
        <DialogHeader className="border-b border-slate-200 px-8 py-6">
          <DialogTitle className="flex items-center gap-3 text-xl font-black tracking-tight">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <UserCog className="h-5 w-5" />
            </span>
            User Management
          </DialogTitle>
          <DialogDescription>
            Manage access to the DeepAgent workspace. {currentUser.role === "super_admin" ? "You can create admins and users." : "You can create and manage user accounts."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-0 lg:grid-cols-[320px_1fr]">
          <div className="border-r border-slate-200 bg-slate-50/70 p-6">
            <div className="mb-5 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white">
                <ShieldPlus className="h-4 w-4" />
              </span>
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Create Account</div>
                <p className="mt-1 text-sm text-slate-500">Provision new accounts with the correct role.</p>
              </div>
            </div>

            <form className="space-y-4" onSubmit={handleCreateUser}>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Email</label>
                <Input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Display Name</label>
                <Input
                  value={form.display_name}
                  onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Temporary Password</label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Role</label>
                <select
                  value={form.role}
                  onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as AuthUser["role"] }))}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                >
                  {allowedRoles.map((role) => (
                    <option key={role} value={role}>
                      {role.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </div>

              {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

              <Button className="w-full" disabled={isLoading}>
                {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Create User"}
              </Button>
            </form>
          </div>

          <div className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Directory</div>
                <p className="mt-1 text-sm text-slate-500">Active users and administrators in this deployment.</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => void loadUsers()} disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>

            <ScrollArea className="h-[55vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.user_id}>
                      <TableCell>
                        <div className="font-semibold text-slate-900">{user.display_name || user.email}</div>
                        <div className="text-xs text-slate-500">{user.email}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.role === "user" ? "secondary" : "default"}>{user.role.replace("_", " ")}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.status === "active" ? "secondary" : "destructive"}>{user.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {user.last_login_at ? new Date(user.last_login_at).toLocaleString() : "Never"}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void toggleStatus(user)}
                            disabled={user.is_seeded || user.role === "super_admin"}
                          >
                            {user.status === "active" ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleResetPassword(user)}
                            disabled={user.role === "super_admin"}
                          >
                            <KeyRound className="mr-1 h-3.5 w-3.5" />
                            Reset
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="border-t border-slate-200 px-8 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
