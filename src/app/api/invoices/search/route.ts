import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

// Search documents for bank reconciliation matching
// type=debit → invoices (expenses)
// type=credit → revenue entries (encaissements) + invoices with document_type=revenue
// no type → both
export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q')?.toLowerCase() || ''
    const amount = searchParams.get('amount') ? parseFloat(searchParams.get('amount')!) : null
    const txType = searchParams.get('type') // 'debit' or 'credit'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let results: any[] = []

    if (txType !== 'credit') {
      // Load invoices (expenses) for DEBIT transactions
      const invSnap = await adminDb
        .collection('invoices')
        .where('user_id', '==', decoded.uid)
        .get()

      const invoices = invSnap.docs
        .map(doc => {
          const d = doc.data()
          // Only expense documents for debits
          if (txType === 'debit' && d.document_type === 'revenue') return null
          return {
            id: doc.id,
            source: 'invoice' as const,
            file_name: d.file_name || '',
            name: d.supplier_name || d.file_name || 'Sans nom',
            invoice_number: d.invoice_number || '',
            date: d.invoice_date || '',
            total_ht: d.total_ht || 0,
            total_ttc: d.total_ttc || 0,
            status: d.status || '',
            document_type: d.document_type || 'expense',
            type: 'invoice' as const,
          }
        })
        .filter(Boolean)

      results.push(...invoices)
    }

    if (txType !== 'debit') {
      // Load revenue entries (encaissements) for CREDIT transactions
      const revSnap = await adminDb
        .collection('revenueEntries')
        .where('user_id', '==', decoded.uid)
        .get()

      const revenues = revSnap.docs.map(doc => {
        const d = doc.data()
        return {
          id: doc.id,
          source: 'revenue' as const,
          file_name: d.file_name || '',
          name: d.entity_name || d.description || d.file_name || 'Sans nom',
          invoice_number: d.reference || '',
          date: d.date || '',
          total_ht: d.amount_ht || 0,
          total_ttc: d.amount_ttc || 0,
          status: d.status || '',
          document_type: 'revenue',
          type: 'revenue' as const,
        }
      })

      results.push(...revenues)

      // Also include invoices marked as revenue (factures de prestation)
      if (txType === 'credit') {
        const invSnap = await adminDb
          .collection('invoices')
          .where('user_id', '==', decoded.uid)
          .get()

        const revenueInvoices = invSnap.docs
          .filter(doc => doc.data().document_type === 'revenue')
          .map(doc => {
            const d = doc.data()
            return {
              id: doc.id,
              source: 'invoice' as const,
              file_name: d.file_name || '',
              name: d.supplier_name || d.file_name || 'Sans nom',
              invoice_number: d.invoice_number || '',
              date: d.invoice_date || '',
              total_ht: d.total_ht || 0,
              total_ttc: d.total_ttc || 0,
              status: d.status || '',
              document_type: 'revenue',
              type: 'invoice' as const,
            }
          })

        results.push(...revenueInvoices)
      }
    }

    // Sort by date desc
    results.sort((a, b) => (b.date || '').localeCompare(a.date || ''))

    // Filter by search query
    if (q) {
      results = results.filter(r =>
        (r.file_name || '').toLowerCase().includes(q) ||
        (r.name || '').toLowerCase().includes(q) ||
        (r.invoice_number || '').toLowerCase().includes(q)
      )
    }

    // If amount provided, sort by closest amount match
    if (amount != null) {
      results.sort((a, b) => {
        const diffA = Math.abs((a.total_ttc || 0) - amount)
        const diffB = Math.abs((b.total_ttc || 0) - amount)
        return diffA - diffB
      })
    }

    // Limit to 50 results
    results = results.slice(0, 50)

    // Map to unified format for the frontend
    const invoices = results.map(r => ({
      id: r.id,
      file_name: r.file_name,
      supplier_name: r.name,
      invoice_number: r.invoice_number,
      invoice_date: r.date,
      total_ht: r.total_ht,
      total_ttc: r.total_ttc,
      status: r.status,
      document_type: r.document_type,
      type: r.type, // 'invoice' or 'revenue'
    }))

    return NextResponse.json({ invoices })
  } catch (error) {
    console.error('Search invoices error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
