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
      // Load invoices (expenses, NOT credit notes) for DEBIT transactions
      const invSnap = await adminDb
        .collection('invoices')
        .where('user_id', '==', decoded.uid)
        .get()

      const invoices = invSnap.docs
        .map(doc => {
          const d = doc.data()
          // Only expense documents for debits (exclude revenue and credit notes)
          if (txType === 'debit' && d.document_type === 'revenue') return null
          if (txType === 'debit' && d.is_credit_note === true) return null
          return {
            id: doc.id,
            source: 'invoice' as const,
            file_name: d.file_name || '',
            name: d.supplier_name || d.file_name || 'Sans nom',
            invoice_number: d.invoice_number || '',
            date: d.invoice_date || '',
            currency: d.currency || 'EUR',
            total_ht: d.total_ht || 0,
            total_ttc: d.total_ttc || 0,
            total_ttc_eur: d.total_ttc_eur || null,
            exchange_rate: d.exchange_rate || null,
            status: d.status || '',
            document_type: d.document_type || 'expense',
            is_credit_note: d.is_credit_note || false,
            type: 'invoice' as const,
          }
        })
        .filter(Boolean)

      results.push(...invoices)

      // Also load payslips for debit transactions (salaries, advances)
      const paySnap = await adminDb
        .collection('payslips')
        .where('user_id', '==', decoded.uid)
        .get()

      const payslips = paySnap.docs.map(doc => {
        const d = doc.data()
        return {
          id: doc.id,
          source: 'payslip' as const,
          file_name: d.file_name || '',
          name: `Bulletin ${d.employee_name || ''} ${d.month || ''}`.trim(),
          invoice_number: '',
          date: d.month ? `${d.month}-01` : '',
          total_ht: d.net_salary || d.gross_salary || 0,
          total_ttc: d.net_salary || d.gross_salary || 0,
          // Also expose individual amounts for matching
          advance_amount: d.advance_amount || 0,
          remaining_salary: d.remaining_salary || 0,
          gross_salary: d.gross_salary || 0,
          status: d.status || '',
          document_type: 'payslip',
          type: 'payslip' as const,
        }
      })

      results.push(...payslips)
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

      // Also include invoices marked as revenue OR credit notes (avoirs/remboursements)
      if (txType === 'credit') {
        const invSnap = await adminDb
          .collection('invoices')
          .where('user_id', '==', decoded.uid)
          .get()

        const creditInvoices = invSnap.docs
          .filter(doc => {
            const d = doc.data()
            return d.document_type === 'revenue' || d.is_credit_note === true
          })
          .map(doc => {
            const d = doc.data()
            const isCreditNote = d.is_credit_note === true
            return {
              id: doc.id,
              source: 'invoice' as const,
              file_name: d.file_name || '',
              name: `${isCreditNote ? '[AVOIR] ' : ''}${d.supplier_name || d.file_name || 'Sans nom'}`,
              invoice_number: d.invoice_number || '',
              date: d.invoice_date || '',
              total_ht: d.total_ht || 0,
              total_ttc: d.total_ttc || 0,
              status: d.status || '',
              document_type: isCreditNote ? 'credit_note' : 'revenue',
              is_credit_note: isCreditNote,
              type: 'invoice' as const,
            }
          })

        results.push(...creditInvoices)
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
    // Use total_ttc_eur (converted) if available, otherwise total_ttc
    if (amount != null) {
      results.sort((a, b) => {
        const amtA = a.total_ttc_eur || a.total_ttc || 0
        const amtB = b.total_ttc_eur || b.total_ttc || 0
        const diffA = Math.abs(amtA - amount)
        const diffB = Math.abs(amtB - amount)
        return diffA - diffB
      })
    }

    // Limit to 50 results
    results = results.slice(0, 50)

    // Map to unified format for the frontend
    // Use EUR amount for matching when available (foreign currency invoices)
    const invoices = results.map(r => ({
      id: r.id,
      file_name: r.file_name,
      supplier_name: r.name,
      invoice_number: r.invoice_number,
      invoice_date: r.date,
      currency: r.currency || 'EUR',
      total_ht: r.total_ht,
      total_ttc: r.total_ttc_eur || r.total_ttc, // EUR amount for matching
      total_ttc_original: r.total_ttc_eur ? r.total_ttc : null, // Original if converted
      exchange_rate: r.exchange_rate || null,
      status: r.status,
      document_type: r.document_type,
      type: r.type,
      advance_amount: r.advance_amount || null,
      remaining_salary: r.remaining_salary || null,
    }))

    return NextResponse.json({ invoices })
  } catch (error) {
    console.error('Search invoices error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
