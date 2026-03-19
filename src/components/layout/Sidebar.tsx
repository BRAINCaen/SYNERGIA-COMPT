'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { signOut } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import {
  LayoutDashboard,
  FileText,
  Upload,
  Download,
  LogOut,
  Zap,
  Landmark,
  Coins,
} from 'lucide-react'

const navigation = [
  { name: 'Tableau de bord', href: '/', icon: LayoutDashboard },
  { name: 'Factures', href: '/invoices', icon: FileText },
  { name: 'Upload', href: '/invoices/upload', icon: Upload },
  { name: 'Releves bancaires', href: '/bank', icon: Landmark },
  { name: 'Recettes', href: '/revenue', icon: Coins },
  { name: 'Export', href: '/export', icon: Download },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  const handleLogout = async () => {
    await signOut(auth)
    document.cookie = 'firebase-auth-token=; path=/; max-age=0'
    router.push('/login')
  }

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-dark-border bg-dark-card">
      <div className="flex h-16 items-center gap-3 border-b border-dark-border px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-green text-dark-bg">
          <Zap className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">SYNERGIA-COMPT</h1>
          <p className="text-xs text-gray-500">BOEHME — B.R.A.I.N.</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navigation.map((item) => {
          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href)
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-accent-green/10 text-accent-green'
                  : 'text-gray-400 hover:bg-dark-hover hover:text-gray-200'
              }`}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-dark-border p-3">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 transition-colors hover:bg-accent-red/10 hover:text-accent-red"
        >
          <LogOut className="h-5 w-5" />
          Deconnexion
        </button>
      </div>
    </aside>
  )
}
