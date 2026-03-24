import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb, adminStorage } from '@/lib/firebase/admin'
import { writeAuditLog } from '@/lib/audit'
import { parseCSV, parseExcel, ParsedTransaction } from '@/lib/bank-parsers'
// PDF parsing handled by separate /api/bank-statements/[id]/analyze endpoint

export const maxDuration = 25 // Allow up to 25s for PDF parsing with Claude Vision

const ALLOWED_EXTENSIONS = ['csv', 'xlsx', 'xls', 'pdf']
const ALLOWED_TYPES = [
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf',
  'text/plain', // some CSV files come as text/plain
]

function getExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || ''
}

function detectFormat(ext: string, mimeType: string): string {
  if (ext === 'csv' || mimeType === 'text/csv' || mimeType === 'text/plain') return 'csv'
  if (ext === 'xlsx' || ext === 'xls' || mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'excel'
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf'
  return 'unknown'
}

/**
 * Compute the most common YYYY-MM among transactions.
 */
function computePeriodMonth(transactions: ParsedTransaction[]): string | null {
  if (transactions.length === 0) return null
  const counts: Record<string, number> = {}
  for (const t of transactions) {
    if (t.date) {
      const ym = t.date.substring(0, 7) // YYYY-MM
      counts[ym] = (counts[ym] || 0) + 1
    }
  }
  let best = ''
  let bestCount = 0
  for (const [ym, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = ym
      bestCount = count
    }
  }
  return best || null
}

/**
 * Write parsed transactions to Firestore in batches of 490.
 */
async function writeTransactions(
  statementId: string,
  userId: string,
  parsed: ParsedTransaction[]
) {
  let totalDebits = 0
  let totalCredits = 0

  for (let i = 0; i < parsed.length; i += 490) {
    const chunk = parsed.slice(i, i + 490)
    const batch = adminDb.batch()

    for (const t of chunk) {
      const isDebit = t.debit != null && t.debit > 0
      const amount = isDebit ? Math.abs(t.debit!) : Math.abs(t.credit!)

      if (isDebit) totalDebits += amount
      else totalCredits += amount

      const ref = adminDb.collection('bankTransactions').doc()
      batch.set(ref, {
        id: ref.id,
        statement_id: statementId,
        user_id: userId,
        date: t.date,
        value_date: t.value_date,
        label: t.label,
        reference: t.reference,
        amount,
        type: isDebit ? 'debit' : 'credit',
        match_status: 'unmatched',
        matched_invoice_id: null,
        matched_revenue_id: null,
        match_confidence: null,
        match_method: null,
        notes: null,
        created_at: new Date().toISOString(),
      })
    }

    await batch.commit()
  }

  return { totalDebits, totalCredits }
}

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'Aucun fichier' }, { status: 400 })
    }

    const ext = getExtension(file.name)
    if (!ALLOWED_EXTENSIONS.includes(ext) && !ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Type de fichier non supporté. Formats acceptés : CSV, XLSX, PDF' },
        { status: 400 }
      )
    }

    const format = detectFormat(ext, file.type)
    const arrayBuffer = await file.arrayBuffer()
    const uploadBuffer = Buffer.from(arrayBuffer)

    // Upload to Firebase Storage
    const storagePath = `bank-statements/${decoded.uid}/${Date.now()}_${crypto.randomUUID()}.${ext}`
    const bucket = adminStorage.bucket()
    const fileRef = bucket.file(storagePath)

    await fileRef.save(uploadBuffer, {
      metadata: { contentType: file.type },
    })

    // Create bankStatements doc
    const statementRef = adminDb.collection('bankStatements').doc()
    const statementData = {
      id: statementRef.id,
      user_id: decoded.uid,
      file_name: file.name,
      file_path: storagePath,
      file_type: file.type,
      format,
      status: 'pending',
      transaction_count: 0,
      total_debits: 0,
      total_credits: 0,
      period_month: null as string | null,
      error_message: null as string | null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    await statementRef.set(statementData)

    // Parse CSV/Excel immediately; PDF requires separate processing
    if (format === 'csv' || format === 'excel') {
      try {
        let parsed: ParsedTransaction[]

        if (format === 'csv') {
          const textContent = new TextDecoder('utf-8').decode(arrayBuffer)
          parsed = parseCSV(textContent)
        } else {
          parsed = parseExcel(arrayBuffer)
        }

        if (parsed.length === 0) {
          await statementRef.update({
            status: 'error',
            error_message: 'Aucune transaction trouvée dans le fichier',
            updated_at: new Date().toISOString(),
          })

          const updatedDoc = await statementRef.get()
          return NextResponse.json({
            success: true,
            statement: { id: updatedDoc.id, ...updatedDoc.data() },
            transaction_count: 0,
          })
        }

        // Write transactions in batches
        const { totalDebits, totalCredits } = await writeTransactions(
          statementRef.id,
          decoded.uid,
          parsed
        )

        const periodMonth = computePeriodMonth(parsed)

        await statementRef.update({
          status: 'parsed',
          transaction_count: parsed.length,
          total_debits: Math.round(totalDebits * 100) / 100,
          total_credits: Math.round(totalCredits * 100) / 100,
          period_month: periodMonth,
          updated_at: new Date().toISOString(),
        })

        await writeAuditLog({
          action: 'bank_statement_upload',
          invoice_id: statementRef.id,
          user_id: decoded.uid,
          after: {
            file_name: file.name,
            format,
            transaction_count: parsed.length,
            total_debits: Math.round(totalDebits * 100) / 100,
            total_credits: Math.round(totalCredits * 100) / 100,
          },
        })

        const updatedDoc = await statementRef.get()
        return NextResponse.json({
          success: true,
          statement: { id: updatedDoc.id, ...updatedDoc.data() },
          transaction_count: parsed.length,
        })
      } catch (parseError) {
        console.error('Parse error:', parseError)
        const errMsg = parseError instanceof Error ? parseError.message : 'Erreur de parsing'
        await statementRef.update({
          status: 'error',
          error_message: errMsg,
          updated_at: new Date().toISOString(),
        })
        const updatedDoc = await statementRef.get()
        return NextResponse.json({
          success: true,
          statement: { id: updatedDoc.id, ...updatedDoc.data() },
          transaction_count: 0,
        })
      }
    }

    // PDF: saved as pending, user clicks "Analyse" to trigger parsing via separate endpoint
    await writeAuditLog({
      action: 'bank_statement_upload',
      invoice_id: statementRef.id,
      user_id: decoded.uid,
      after: { file_name: file.name, format, status: 'pending' },
    })

    return NextResponse.json({
      success: true,
      statement: statementData,
      transaction_count: 0,
    })
  } catch (error) {
    console.error('Upload bank statement error:', error)
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
