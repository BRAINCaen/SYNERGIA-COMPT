import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import anthropic, { FAST_MODEL } from '@/lib/anthropic'
// @ts-expect-error pdf-parse has no types
import pdfParse from 'pdf-parse'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    // Step 1: Extract text from PDF (fast, no AI needed)
    const pdfData = await pdfParse(buffer)
    const text = pdfData.text

    if (!text || text.trim().length < 50) {
      return NextResponse.json({ error: 'PDF illisible ou vide' }, { status: 400 })
    }

    // Step 2: Send extracted TEXT to Claude Haiku (much faster than sending PDF)
    const response = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `Extrais les transactions de ce relevé bancaire.
JSON uniquement: [{"date":"YYYY-MM-DD","label":"libellé","debit":nombre_ou_null,"credit":nombre_ou_null}]
Dates JJ/MM → YYYY-MM-DD. Montants en nombres. Exclure soldes et totaux.

TEXTE DU RELEVÉ:
${text.substring(0, 12000)}`
      }],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'Pas de réponse IA' }, { status: 500 })
    }

    let jsonText = textBlock.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const transactions = JSON.parse(jsonText)
    return NextResponse.json({ transactions })
  } catch (error) {
    console.error('Parse PDF error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur' }, { status: 500 })
  }
}
