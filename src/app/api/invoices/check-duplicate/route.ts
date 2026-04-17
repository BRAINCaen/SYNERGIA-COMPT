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

    if (!supplierName && !invoiceNumber) {
      return NextResponse.json({ isDuplicate: false })
    }

    // Fetch ALL invoices for user (supplier name spelling can vary — don't rely on exact match)
    // Then filter client-side with normalization
    const userSnap = await adminDb.collection('invoices')
      .where('user_id', '==', decoded.uid)
      .get()

    if (userSnap.empty) {
      return NextResponse.json({ isDuplicate: false })
    }

    // Normalize supplier: strip accents, parens content, special chars
    const normalizeSupplier = (s: string) =>
      s.toUpperCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\([^)]*\)/g, '')
        .replace(/[^A-Z0-9]/g, '')
        .trim()

    const newSupplierNorm = supplierName ? normalizeSupplier(supplierName) : ''

    for (const doc of userSnap.docs) {
      const data = doc.data()

      const existingSupplierNorm = normalizeSupplier((data.supplier_name || '').toString())
      const sameNormalizedSupplier = newSupplierNorm && existingSupplierNorm && newSupplierNorm === existingSupplierNorm

      // Check invoice number match (strongest signal — always duplicate)
      const numberMatch = invoiceNumber && data.invoice_number &&
        data.invoice_number.toString().trim().toUpperCase() === invoiceNumber.trim().toUpperCase()

      // Amount match within 1 cent
      const amountMatch = totalTtc && data.total_ttc != null &&
        Math.abs(Number(data.total_ttc) - parseFloat(totalTtc)) < 0.01

      // Same month
      let sameMonth = false
      if (invoiceDate && data.invoice_date) {
        sameMonth = invoiceDate.substring(0, 7) === data.invoice_date.substring(0, 7)
      } else if (!invoiceDate && !data.invoice_date) {
        sameMonth = true
      }

      // Duplicate conditions (any of these):
      // 1. Same invoice number + same amount (ignoring supplier spelling) = duplicate
      // 2. Same normalized supplier + same amount + same month = duplicate
      if (numberMatch && amountMatch) {
        return NextResponse.json({
          isDuplicate: true,
          existingId: doc.id,
          existingFileName: data.file_name || 'facture existante',
        })
      }

      if (sameNormalizedSupplier && amountMatch && sameMonth) {
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
