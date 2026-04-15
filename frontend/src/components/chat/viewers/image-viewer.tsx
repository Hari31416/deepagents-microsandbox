import { useState, useRef, useEffect } from 'react'
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ImageViewerProps {
  url: string
  alt: string
}

export function ImageViewer({ url, alt }: ImageViewerProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const handleZoomIn = () => setScale((s) => Math.min(s + 0.2, 5))
  const handleZoomOut = () => setScale((s) => Math.max(s - 0.2, 0.5))
  const handleReset = () => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    })
  }

  const handleMouseUp = () => setIsDragging(false)

  // Use wheel for zooming
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      setScale((s) => Math.min(Math.max(s + delta, 0.5), 5))
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [])

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false

    const loadImage = async () => {
      try {
        const response = await fetch(url, { credentials: 'include' })
        if (!response.ok) {
          throw new Error(`Failed to load image: ${response.status}`)
        }
        const blob = await response.blob()
        objectUrl = window.URL.createObjectURL(blob)
        if (!cancelled) {
          setImageUrl(objectUrl)
        }
      } catch (err) {
        console.error('Failed to load image content:', err)
        if (!cancelled) {
          setImageUrl(null)
        }
      }
    }

    void loadImage()

    return () => {
      cancelled = true
      if (objectUrl) {
        window.URL.revokeObjectURL(objectUrl)
      }
    }
  }, [url])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-50/50 dark:bg-slate-900/50 border-b border-border/10">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400 font-mono tracking-tighter">Zoom: {(scale * 100).toFixed(0)}%</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md opacity-60 hover:opacity-100" onClick={handleZoomOut}>
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md opacity-60 hover:opacity-100" onClick={handleZoomIn}>
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md opacity-60 hover:opacity-100" onClick={handleReset}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      
      <div 
        ref={containerRef}
        className="flex-1 relative cursor-grab active:cursor-grabbing overflow-hidden flex items-center justify-center bg-slate-900/5 dark:bg-black/20"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <img
          src={imageUrl || undefined}
          alt={alt}
          className="max-w-full max-h-full object-contain transition-transform duration-200 ease-out select-none shadow-2xl"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            pointerEvents: isDragging ? 'none' : 'auto'
          }}
          draggable={false}
        />
      </div>
    </div>
  )
}
