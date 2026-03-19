import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb, adminStorage } from '@/lib/firebase/admin'
import { writeAuditLog } from '@/lib/audit'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const statementDoc = await adminDb.collection('bankStatements').doc(params.id).get()
    if (!statementDoc.exists) {
      return NextResponse.json({ error: 'Relevé non trouvé' }, { status: 404 })
    }

    const statement = statementDoc.data()!

    // Get transaction count summary
    const transSnap = await adminDb
      .collection('bankTransactions')
      .where('statement_id', '==', params.id)
      .get()

    let matched = 0
    let unmatched = 0
    let debits = 0
    let credits = 0

    transSnap.docs.forEach((doc) => {
      const data = doc.data()
      if (data.match_status === 'matched') matched++
      else unmatched++
      if (data.type === 'debit') debits++
      else credits++
    })

    return NextResponse.json({
      id: statementDoc.id,
      ...statement,
      summary: {
        total_transactions: transSnap.size,
        matched,
        unmatched,
        debits,
        credits,
      },
    })
  } catch (error) {
    console.error('GET bank-statement error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const statementDoc = await adminDb.collection('bankStatements').doc(params.id).get()
    if (!statementDoc.exists) {
      return NextResponse.json({ error: 'Relevé non trouvé' }, { status: 404 })
    }

    const data = statementDoc.data()!

    // Delete file from storage
    try {
      const bucket = adminStorage.bucket()
      await bucket.file(data.file_path).delete()
    } catch (e) {
      console.error('Error deleting bank statement file:', e)
    }

    // Delete all transactions in batches
    const transSnap = await adminDb
      .collection('bankTransactions')
      .where('statement_id', '==', params.id)
      .get()

    const docs = transSnap.docs
    for (let i = 0; i < docs.length; i += 490) {
      const chunk = docs.slice(i, i + 490)
      const batch = adminDb.batch()
      chunk.forEach((doc) => batch.delete(doc.ref))
      await batch.commit()
    }

    // Audit log
    await writeAuditLog({
      action: 'bank_statement_delete',
      invoice_id: params.id,
      user_id: decoded.uid,
      before: {
        file_name: data.file_name,
        status: data.status,
        transaction_count: data.transaction_count,
      },
      after: null,
    })

    // Delete statement
    await adminDb.collection('bankStatements').doc(params.id).delete()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE bank-statement error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
