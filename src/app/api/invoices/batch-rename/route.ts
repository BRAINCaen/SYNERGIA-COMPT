export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb } from '@/lib/firebase/admin'

function buildFileName(data: Record<string, unknown>): string | null {
  const supplier = typeof data.supplier_name === 'string' ? data.supplier_name.trim() : ''
  const totalTtc = typeof data.total_ttc === 'number' ? data.total_ttc : (typeof data.total_ttc === 'string' ? parseFloat(data.total_ttc) : NaN)
  const date = typeof data.invoice_date === 'string' ? data.invoice_date : (typeof data.created_at === 'string' ? data.created_at : '')
  const invoiceNumber = typeof data.invoice_number === 'string' ? data.invoice_number.trim() : ''
  const currentName = typeof data.file_name === 'string' ? data.file_name : ''
  const ext = currentName.includes('.') ? currentName.split('.').pop()?.toLowerCase() || 'pdf' : 'pdf'

  // Need at least supplier to rename
  if (!supplier) return null

  const parts: string[] = []

  // Supplier name: uppercase, remove all special chars, replace spaces with underscores
  const cleanSupplier = supplier
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^A-Z0-9\s]/g, '') // keep only letters, digits, spaces
    .replace(/\s+/g, '_')
    .slice(0, 40)
  if (cleanSupplier) parts.push(cleanSupplier)

  // Amount
  if (!isNaN(totalTtc) && totalTtc > 0) {
    parts.push(`${totalTtc.toFixed(2).replace('.', ',')}EUR`)
  }

  // Date (YYYYMMDD)
  if (date && date.length >= 10) {
    const d = date.slice(0, 10).replace(/-/g, '')
    if (/^\d{8}$/.test(d)) parts.push(d)
  }

  // Invoice number
  if (invoiceNumber) {
    const cleanNum = invoiceNumber.replace(/[^A-Za-z0-9-]/g, '').slice(0, 30)
    if (cleanNum) parts.push(cleanNum)
  }

  if (parts.length === 0) return null

  return `${parts.join('-')}.${ext}`
}

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const snap = await adminDb
      .collection('invoices')
      .where('user_id', '==', decoded.uid)
      .get()

    let renamed = 0
    let skipped = 0
    let noData = 0
    let sameNameCount = 0
    const now = new Date().toISOString()
    const examples: string[] = []

    const docs = snap.docs
    for (let i = 0; i < docs.length; i += 490) {
      const chunk = docs.slice(i, i + 490)
      const batch = adminDb.batch()
      let batchHasUpdates = false

      for (const doc of chunk) {
        const data = doc.data()
        const newName = buildFileName(data)

        if (!newName) {
          noData++
          continue
        }

        const currentName = (data.file_name as string) || ''
        if (currentName === newName) {
          sameNameCount++
          continue
        }

        batch.update(doc.ref, { file_name: newName, updated_at: now })
        batchHasUpdates = true
        renamed++

        if (examples.length < 5) {
          examples.push(`${currentName} → ${newName}`)
        }
      }

      if (batchHasUpdates) {
        await batch.commit()
      }
    }

    return NextResponse.json({
      success: true,
      renamed,
      skipped: sameNameCount,
      noData,
      total: docs.length,
      examples,
    })
  } catch (error) {
    console.error('Batch rename error:', error)
    const msg = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
