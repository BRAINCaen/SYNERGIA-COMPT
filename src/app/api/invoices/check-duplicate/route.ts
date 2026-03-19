import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const invoiceNumber = searchParams.get('invoice_number')
    const supplierName = searchParams.get('supplier_name')
    const totalTtc = searchParams.get('total_ttc')
    const invoiceDate = searchParams.get('invoice_date') // YYYY-MM-DD

    if (!supplierName) {
      return NextResponse.json({ isDuplicate: false })
    }

    // Strategy: check supplier + amount + date (same month = potential duplicate)
    // For recurring invoices (ORANGE, EDF...) same supplier + same amount but different month = NOT duplicate
    let query = adminDb.collection('invoices')
      .where('supplier_name', '==', supplierName)

    const snap = await query.limit(50).get()

    if (snap.empty) {
      return NextResponse.json({ isDuplicate: false })
    }

    for (const doc of snap.docs) {
      const data = doc.data()

      // Check invoice number match (strongest signal)
      const numberMatch = invoiceNumber && data.invoice_number && data.invoice_number === invoiceNumber

      // Check amount match (within 1 cent)
      const amountMatch = totalTtc && data.total_ttc != null &&
        Math.abs(data.total_ttc - parseFloat(totalTtc)) < 0.01

      // Check date match (same month = duplicate, different month = recurring)
      let sameMonth = false
      if (invoiceDate && data.invoice_date) {
        const newMonth = invoiceDate.substring(0, 7) // YYYY-MM
        const existingMonth = data.invoice_date.substring(0, 7)
        sameMonth = newMonth === existingMonth
      } else if (!invoiceDate && !data.invoice_date) {
        // Both have no date, consider same period
        sameMonth = true
      }

      // Duplicate conditions:
      // 1. Same invoice number + same supplier (strongest - always duplicate regardless of date)
      // 2. Same supplier + same amount + same month (recurring invoice same month = duplicate)
      if (numberMatch) {
        // Same invoice number = definite duplicate
        return NextResponse.json({
          isDuplicate: true,
          existingId: doc.id,
          existingFileName: data.file_name || 'facture existante',
        })
      }

      if (amountMatch && sameMonth) {
        // Same supplier + same amount + same month = duplicate
        return NextResponse.json({
          isDuplicate: true,
          existingId: doc.id,
          existingFileName: data.file_name || 'facture existante',
        })
      }
    }

    return NextResponse.json({ isDuplicate: false })
  } catch (error) {
    console.error('Check duplicate error:', error)
    return NextResponse.json({ isDuplicate: false })
  }
}
