import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb, adminStorage } from '@/lib/firebase/admin'

const VALID_SOURCES = [
  'tpe_virtuel',
  'virement',
  'tpe_sur_place',
  'cheque',
  'ancv',
  'especes',
]

export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const month = searchParams.get('month') // YYYY-MM
    const source = searchParams.get('source')

    const snapshot = await adminDb
      .collection('revenueEntries')
      .where('user_id', '==', decoded.uid)
      .get()

    let entries = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''))

    if (source) {
      if (!VALID_SOURCES.includes(source)) {
        return NextResponse.json(
          { error: `Source invalide. Sources acceptées : ${VALID_SOURCES.join(', ')}` },
          { status: 400 }
        )
      }
      entries = entries.filter((e: any) => e.source === source)
    }

    // Filter by month client-side (Firestore doesn't support range + orderBy on different fields easily)
    if (month) {
      const monthRegex = /^\d{4}-\d{2}$/
      if (!monthRegex.test(month)) {
        return NextResponse.json(
          { error: 'Format de mois invalide. Utilisez YYYY-MM' },
          { status: 400 }
        )
      }
      entries = entries.filter((e: Record<string, unknown>) => {
        const d = String(e.date || '')
        return d.startsWith(month)
      })
    }

    return NextResponse.json(entries)
  } catch (error) {
    console.error('GET revenue error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const contentType = request.headers.get('content-type') || ''
    let body: Record<string, unknown>
    let file: File | null = null

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      file = formData.get('file') as File | null

      body = {
        date: formData.get('date') as string,
        source: formData.get('source') as string,
        description: formData.get('description') as string,
        amount_ht: parseFloat(formData.get('amount_ht') as string),
        tva_rate: parseFloat(formData.get('tva_rate') as string),
        amount_ttc: parseFloat(formData.get('amount_ttc') as string),
        pcg_code: formData.get('pcg_code') as string,
        pcg_label: formData.get('pcg_label') as string,
        journal_code: formData.get('journal_code') as string,
      }
    } else {
      body = await request.json()
    }

    // Validation
    if (!body.date || !body.source || body.amount_ht == null || body.amount_ttc == null) {
      return NextResponse.json(
        { error: 'Champs obligatoires manquants : date, source, amount_ht, amount_ttc' },
        { status: 400 }
      )
    }

    if (!VALID_SOURCES.includes(body.source as string)) {
      return NextResponse.json(
        { error: `Source invalide. Sources acceptées : ${VALID_SOURCES.join(', ')}` },
        { status: 400 }
      )
    }

    const amountHt = Number(body.amount_ht)
    const amountTtc = Number(body.amount_ttc)
    const tvaRate = body.tva_rate != null ? Number(body.tva_rate) : 0
    const tvaAmount = Math.round((amountTtc - amountHt) * 100) / 100

    // Upload file to Storage if provided
    let filePath: string | null = null
    let fileName: string | null = null

    if (file) {
      if (file.type !== 'application/pdf') {
        return NextResponse.json(
          { error: 'Seuls les fichiers PDF sont acceptés' },
          { status: 400 }
        )
      }

      const rawBytes = new Uint8Array(await file.arrayBuffer())
      filePath = `revenue/${decoded.uid}/${Date.now()}_${crypto.randomUUID()}.pdf`
      fileName = file.name

      const bucket = adminStorage.bucket()
      const fileRef = bucket.file(filePath)
      await fileRef.save(Buffer.from(rawBytes), {
        metadata: { contentType: 'application/pdf' },
      })
    }

    const docRef = adminDb.collection('revenueEntries').doc()
    const entryData = {
      id: docRef.id,
      user_id: decoded.uid,
      date: body.date,
      source: body.source,
      description: body.description || null,
      amount_ht: amountHt,
      tva_rate: tvaRate,
      tva_amount: tvaAmount,
      amount_ttc: amountTtc,
      pcg_code: body.pcg_code || null,
      pcg_label: body.pcg_label || null,
      journal_code: (body.journal_code as string) || 'VE',
      status: 'draft',
      file_path: filePath,
      file_name: fileName,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    await docRef.set(entryData)

    return NextResponse.json({ success: true, entry: entryData })
  } catch (error) {
    console.error('POST revenue error:', error)
    const message = error instanceof Error ? error.message : 'Erreur serveur'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
