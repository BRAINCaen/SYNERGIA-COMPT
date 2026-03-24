import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import anthropic, { FAST_MODEL } from '@/lib/anthropic'

export const dynamic = 'force-dynamic'

// Lightweight endpoint: just call Claude with PDF, return parsed transactions
// No Firebase operations to minimize execution time
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
    const base64Pdf = buffer.toString('base64')

    const response = await anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf },
          },
          {
            type: 'text',
            text: `Extrais TOUTES les transactions de ce relevé bancaire.
JSON uniquement, pas de texte. Format:
[{"date":"YYYY-MM-DD","label":"libellé","debit":montant_ou_null,"credit":montant_ou_null}]
Dates JJ/MM/AAAA → YYYY-MM-DD. Montants en nombres. Exclure soldes.`
          }
        ],
      }],
    })

    const textBlock = response.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'Pas de réponse' }, { status: 500 })
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
