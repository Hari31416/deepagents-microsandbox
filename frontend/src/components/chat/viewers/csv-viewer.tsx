import { useEffect, useState, useMemo } from 'react'
import { RefreshCw, Search, Download, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { triggerDownload } from '@/lib/utils'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  getFilteredRowModel,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import Papa from "papaparse"
import {
  Table as ShadcnTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface CsvViewerProps {
  url: string
  filename: string
}

export function CsvViewer({ url, filename }: CsvViewerProps) {
  const [rawData, setRawData] = useState<any[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState("")

  const fetchContent = async () => {
    setIsLoading(true)
    try {
      const response = await fetch(url)
      const text = await response.text()
      
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          setRawData(results.data)
          if (results.meta.fields) {
            setHeaders(results.meta.fields)
          }
        },
        error: (err: Error) => {
          console.error('PapaParse error:', err)
        }
      })
    } catch (err) {
      console.error('Failed to fetch CSV content:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchContent()
  }, [url])

  const columns = useMemo<ColumnDef<any>[]>(() => {
    return headers.map(header => ({
      accessorKey: header,
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            className="h-8 px-2 -ml-2 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-primary transition-colors hover:bg-transparent"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            {header}
            {column.getIsSorted() === "asc" ? (
              <ChevronUp className="ml-1 h-3 w-3" />
            ) : column.getIsSorted() === "desc" ? (
              <ChevronDown className="ml-1 h-3 w-3" />
            ) : (
              <ArrowUpDown className="ml-1 h-3 w-3 opacity-20" />
            )}
          </Button>
        )
      },
      cell: ({ row }) => <div className="text-slate-600 dark:text-slate-300 font-medium">{row.getValue(header)}</div>,
    }))
  }, [headers])

  const table = useReactTable({
    data: rawData,
    columns,
    state: {
      sorting,
      globalFilter,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-50/50 dark:bg-slate-900/50 border-b border-border/10">
        <div className="flex items-center gap-2">
          <div className="relative w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
            <Input 
              placeholder="Search..." 
              className="h-7 pl-8 text-[11px] bg-slate-100 dark:bg-black/20 border-none focus-visible:ring-1 rounded-md"
              value={globalFilter ?? ""}
              onChange={(e) => setGlobalFilter(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md opacity-60 hover:opacity-100" onClick={fetchContent} disabled={isLoading}>
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md opacity-60 hover:opacity-100" onClick={() => triggerDownload(url, filename)}>
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col bg-white dark:bg-slate-950">
        {isLoading ? (
          <div className="flex items-center justify-center p-24">
            <RefreshCw className="h-8 w-8 animate-spin text-slate-200" />
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="min-w-full inline-block align-middle">
              <ShadcnTable className="text-[11px]">
                <TableHeader className="bg-slate-50 dark:bg-slate-950/80 backdrop-blur-md sticky top-0 z-10">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id} className="hover:bg-transparent border-b border-border/50">
                      {headerGroup.headers.map((header) => (
                        <TableHead key={header.id} className="h-10 px-4">
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody className="divide-y divide-border/30">
                  {table.getRowModel().rows?.length ? (
                    table.getRowModel().rows.map((row) => (
                      <TableRow
                        key={row.id}
                        data-state={row.getIsSelected() && "selected"}
                        className="hover:bg-slate-50/50 dark:hover:bg-slate-900/50 transition-colors border-border/10"
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id} className="px-4 py-2">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={columns.length} className="h-24 text-center text-slate-400 font-mono text-[10px] uppercase tracking-widest">
                        No results.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </ShadcnTable>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        )}
      </div>
      
      <div className="px-4 py-2 border-t border-border/30 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between text-[10px] text-slate-400 font-mono">
        <div className="flex items-center gap-4">
          <span>Rows: {table.getFilteredRowModel().rows.length} {globalFilter && `(filtered from ${rawData.length})`}</span>
          <span>Columns: {headers.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {sorting.length > 0 && (
            <Button variant="ghost" size="sm" className="h-5 px-2 text-[9px] hover:text-primary transition-all" onClick={() => setSorting([])}>
              Clear Sort
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
