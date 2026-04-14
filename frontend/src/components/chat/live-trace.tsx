import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Loader2, Radio, Terminal } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { type StreamActivity } from '../../types/chat'

export function LiveTrace({
  activities,
  runId,
  isStreaming,
}: {
  activities: StreamActivity[]
  runId?: string
  isStreaming: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(isStreaming)

  if (!runId && activities.length === 0 && !isStreaming) {
    return null
  }

  // Hide internal noise
  const filteredActivities = activities.filter((a) => !['Draft response updated', 'Plan updated', 'Task'].includes(a.label))

  return (
    <div className="group/trace relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md shadow-sm transition-all duration-300">
      <div
        className="flex items-center justify-between gap-4 px-4 py-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center">
            {isStreaming ? (
              <div className="h-4 w-4">
                <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping" />
                <Loader2 className="h-4 w-4 animate-spin text-primary relative z-10" />
              </div>
            ) : (
              <Terminal className="h-3.5 w-3.5 text-slate-400" />
            )}
          </div>
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
            {isStreaming ? 'Agent Actions' : 'Execution Trace'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {filteredActivities.length > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
              {filteredActivities.length} Steps
            </span>
          )}
          <ChevronDown
            className={cn('h-3.5 w-3.5 text-slate-400 transition-transform duration-300', isExpanded ? 'rotate-0' : '-rotate-90')}
          />
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-slate-100 dark:border-slate-800/50"
          >
            <div className="p-3 bg-slate-50/50 dark:bg-slate-950/20 max-h-[400px] overflow-y-auto custom-scrollbar">
              <div className="relative pl-2.5 border-l border-slate-200 dark:border-slate-800 ml-1.5 space-y-4 py-2">
                {filteredActivities.length === 0 && isStreaming && (
                  <div className="flex items-center gap-2 py-2 text-primary/60">
                    <Radio className="h-3 w-3 animate-pulse" />
                    <span className="text-[10px] font-medium animate-pulse">Initializing...</span>
                  </div>
                )}

                {filteredActivities.map((activity) => (
                  <div key={activity.id} className="relative group/item">
                    {/* Circle on timeline */}
                    <div
                      className={cn(
                        'absolute -left-[14.5px] top-1.5 w-2 h-2 rounded-full border bg-background z-10 shadow-sm',
                        activity.state === 'live'
                          ? 'border-primary animate-pulse shadow-primary/20'
                          : activity.state === 'error'
                            ? 'border-rose-500'
                            : activity.state === 'done'
                              ? 'border-emerald-500 bg-emerald-500/10'
                              : 'border-slate-300 dark:border-slate-700',
                      )}
                    />

                    <div className="pl-4 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'text-[11px] font-bold tracking-tight',
                            activity.state === 'error' ? 'text-rose-500' : 'text-slate-700 dark:text-slate-200',
                          )}
                        >
                          {activity.label}
                        </span>
                        {activity.state === 'live' && <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />}
                      </div>

                      {(activity.args || activity.result) && <ActivityDetails activity={activity} />}

                      {activity.detail && !activity.args && !activity.result && (
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed max-w-lg">{activity.detail}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ActivityDetails({ activity }: { activity: StreamActivity }) {
  const [isOpen, setIsOpen] = useState(false)
  const isCode = activity.kind === 'tool_call' || activity.kind === 'tool_result'

  return (
    <div className="space-y-1.5">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100/80 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-[9px] font-black uppercase tracking-wider text-slate-500"
      >
        {isCode ? (isOpen ? 'Hide Payload' : 'View Payload') : isOpen ? 'Collapse' : 'Expand Details'}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-lg bg-slate-900 dark:bg-black p-3 text-[10px] font-mono leading-relaxed text-slate-300 border border-slate-800/50 shadow-inner overflow-x-auto max-h-60 overflow-y-auto custom-scrollbar">
              {activity.args && (
                <div className="space-y-2">
                  <div className="text-[8px] text-slate-500 font-bold uppercase tracking-widest border-b border-slate-800 pb-1 mb-2">
                    Input Parameters
                  </div>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{activity.args}</ReactMarkdown>
                </div>
              )}
              {activity.result && (
                <div className="space-y-2 mt-4">
                  <div className="text-[8px] text-emerald-500/70 font-bold uppercase tracking-widest border-b border-slate-800 pb-1 mb-2">
                    Output Result
                  </div>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{activity.result}</ReactMarkdown>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
