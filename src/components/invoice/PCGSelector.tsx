'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { Search, ChevronDown } from 'lucide-react'
import type { PCGAccount } from '@/types'

interface PCGSelectorProps {
  accounts: PCGAccount[]
  value: string | null
  onChange: (code: string, label: string) => void
}

export default function PCGSelector({ accounts, value, onChange }: PCGSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    if (!search) return accounts.slice(0, 50)
    const q = search.toLowerCase()
    return accounts
      .filter(
        (a) =>
          a.code.toLowerCase().includes(q) ||
          a.label.toLowerCase().includes(q)
      )
      .slice(0, 50)
  }, [accounts, search])

  const selected = useMemo(
    () => accounts.find((a) => a.code === value),
    [accounts, value]
  )

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm shadow-sm hover:border-gray-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
      >
        <span className={selected ? 'text-gray-900' : 'text-gray-400'}>
          {selected ? `${selected.code} - ${selected.label}` : 'Sélectionner un compte PCG'}
        </span>
        <ChevronDown className="h-4 w-4 text-gray-400" />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher par code ou libellé..."
                className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm text-gray-500">Aucun résultat</p>
            ) : (
              filtered.map((account) => (
                <button
                  key={account.code}
                  type="button"
                  onClick={() => {
                    onChange(account.code, account.label)
                    setIsOpen(false)
                    setSearch('')
                  }}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-primary-50 ${
                    account.code === value ? 'bg-primary-50 text-primary-700' : 'text-gray-700'
                  }`}
                >
                  <span className="font-mono font-medium text-primary-600">
                    {account.code}
                  </span>
                  <span className="truncate">{account.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
