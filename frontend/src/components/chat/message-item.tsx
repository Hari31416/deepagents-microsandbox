import { motion } from 'framer-motion'
import { Bot, Loader2, User as UserIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type Message } from '../../types/chat'
import { MarkdownRenderer } from './markdown-renderer'
import { LiveTrace } from './live-trace'

import { format } from 'date-fns'

interface MessageItemProps {
  message: Message
  idx: number
}

export function MessageItem({ message, idx }: MessageItemProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: idx * 0.05 }}
      key={message.id}
      className={cn('flex gap-6 items-start group', message.role === 'assistant' ? 'flex-row' : 'flex-row')}
    >
      <div
        className={cn(
          'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-lg transition-transform group-hover:scale-105',
          message.role === 'assistant' ? 'bg-slate-900 dark:bg-primary text-white' : 'bg-white dark:bg-slate-800 border border-border',
        )}
      >
        {message.role === 'assistant' ? <Bot className="h-6 w-6" /> : <UserIcon className="h-5 w-5 text-slate-600 dark:text-slate-300" />}
      </div>
      <div className="flex-1 min-w-0 space-y-4">
        <div
          className={cn(
            'flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em]',
            message.role === 'assistant' ? 'text-primary' : 'text-slate-400',
          )}
        >
          {message.role === 'assistant' ? 'Agent' : 'You'}
          {message.createdAt && (
            <span className="text-[9px] font-medium text-slate-400 normal-case tracking-normal ml-1">
              • {format(new Date(message.createdAt), 'HH:mm:ss')}
            </span>
          )}
          <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800/50" />
        </div>

        {message.role === 'assistant' && (
          <LiveTrace activities={message.activities || []} runId={message.runId} isStreaming={Boolean(message.isStreaming)} />
        )}

        <div className="min-h-[1.5rem] transition-all">
          <MarkdownRenderer content={message.content} role={message.role} isStreaming={message.isStreaming} />
          {message.isStreaming && !message.content && (
            <div className="flex items-center gap-3 text-primary animate-pulse py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs font-bold tracking-widest uppercase">Thinking...</span>
            </div>
          )}
        </div>

        {message.isStreaming && message.content && (
          <div className="flex items-center gap-2 text-primary/60 border-t border-primary/10 pt-4 mt-4">
            <div className="flex gap-1">
              <div className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
              <div className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
              <div className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest">Streaming Output</span>
          </div>
        )}
      </div>
    </motion.div>
  )
}
