import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, ChevronDown, Circle, CircleDashed, ListTodo } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type Todo } from '../../types/chat'

export function IntegratedTodoPanel({ todos }: { todos: Todo[] }) {
  const [isExpanded, setIsExpanded] = useState(false)
  if (!todos.length) return null

  const completedCount = todos.filter((t) => t.status === 'completed').length
  const progress = (completedCount / todos.length) * 100
  const activeTask = todos.find((t) => t.status === 'in_progress') || todos.find((t) => t.status === 'pending')

  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border border-slate-200 dark:border-slate-800 rounded-2xl shadow-lg overflow-hidden transition-all duration-300"
    >
      <div
        className="px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <ListTodo className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Analysis Plan</span>
              <span className="text-[10px] font-bold text-primary tabular-nums">
                {completedCount}/{todos.length}
              </span>
            </div>
            <div className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
              {activeTask?.content || 'Finalizing process...'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="w-24 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden hidden sm:block">
            <motion.div className="h-full bg-primary" initial={{ width: 0 }} animate={{ width: `${progress}%` }} />
          </div>
          <div
            className={cn(
              'p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 transition-all duration-300',
              isExpanded && 'rotate-180 bg-primary/10 text-primary',
            )}
          >
            <ChevronDown className="h-4 w-4" />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-slate-100 dark:border-slate-800/50"
          >
            <div className="p-4 space-y-2.5 max-h-48 overflow-y-auto custom-scrollbar">
              {todos.map((todo, idx) => (
                <motion.div
                  key={idx}
                  initial={{ x: -10, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: idx * 0.03 }}
                  className="flex items-start gap-4 group"
                >
                  <div className="mt-0.5 shrink-0 transition-transform group-hover:scale-110">
                    {todo.status === 'completed' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : todo.status === 'in_progress' ? (
                      <CircleDashed className="h-4 w-4 text-primary animate-spin" />
                    ) : (
                      <Circle className="h-4 w-4 text-slate-300 dark:text-slate-700" />
                    )}
                  </div>
                  <span
                    className={cn(
                      'text-[13px] leading-tight transition-all',
                      todo.status === 'completed'
                        ? 'text-slate-400 line-through decoration-slate-300'
                        : todo.status === 'in_progress'
                          ? 'text-slate-900 dark:text-white font-bold'
                          : 'text-slate-600 dark:text-slate-400 font-medium',
                    )}
                  >
                    {todo.content}
                  </span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
