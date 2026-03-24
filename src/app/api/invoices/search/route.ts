import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

// Search invoices for manual bank reconciliation matching
export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q')?.toLowerCase() || ''
    const amount = searchParams.get('amount') ? parseFloat(searchParams.get('amount')!) : null
    const type = searchParams.get('type') // 'debit' or 'credit'

    // Load all invoices for this user
    const snap = await adminDb
      .collection('invoices')
      .where('user_id', '==', decoded.uid)
      .get()

    let invoices = snap.docs.map(doc => {
      const d = doc.data()
      return {
        id: doc.id,
        file_name: d.file_name || '',
        supplier_name: d.supplier_name || '',
        invoice_number: d.invoice_number || '',
        invoice_date: d.invoice_date || '',
        total_ht: d.total_ht || 0,
        total_ttc: d.total_ttc || 0,
        status: d.status || '',
        document_type: d.document_type || 'expense',
      }
    })

    // Sort by date desc
    invoices.sort((a, b) => (b.invoice_date || '').localeCompare(a.invoice_date || ''))

    // Filter by search query
    if (q) {
      invoices = invoices.filter(inv =>
        inv.file_name.toLowerCase().includes(q) ||
        inv.supplier_name.toLowerCase().includes(q) ||
        inv.invoice_number.toLowerCase().includes(q)
      )
    }

    // If amount provided, sort by closest amount match
    if (amount != null) {
      invoices.sort((a, b) => {
        const diffA = Math.abs((a.total_ttc || 0) - amount)
        const diffB = Math.abs((b.total_ttc || 0) - amount)
        return diffA - diffB
      })
    }

    // Limit to 50 results
    invoices = invoices.slice(0, 50)

    return NextResponse.json({ invoices })
  } catch (error) {
    console.error('Search invoices error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
