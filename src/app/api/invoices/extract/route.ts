import { NextRequest, NextResponse } from 'next/server'
import anthropic, { EXTRACTION_MODEL, MAX_TOKENS } from '@/lib/anthropic'
import type { RawExtraction } from '@/types'

const EXTRACTION_PROMPT = `Tu es un expert comptable français. Analyse cette facture et extrais TOUTES les informations dans un format JSON structuré.

Extrais les informations suivantes :
1. **Fournisseur** : nom, adresse, SIRET, numéro TVA intracommunautaire, téléphone, email
2. **Facture** : numéro, date (format YYYY-MM-DD), date d'échéance, conditions de paiement
3. **Lignes de facture** : pour CHAQUE ligne, extrais description, quantité, prix unitaire HT, total HT, taux TVA (%), montant TVA, total TTC
4. **Totaux** : total HT, total TVA, total TTC, détail TVA par taux

IMPORTANT :
- Les montants doivent être des nombres (pas de symboles € ou espaces)
- Les dates au format YYYY-MM-DD
- Si une information n'est pas lisible ou absente, utilise null
- Pour les taux de TVA, utilise le pourcentage (ex: 20 pour 20%)

Réponds UNIQUEMENT avec le JSON suivant (pas de texte autour) :
{
  "supplier": {
    "name": "string",
    "address": "string | null",
    "siret": "string | null",
    "tva_intra": "string | null",
    "phone": "string | null",
    "email": "string | null"
  },
  "invoice": {
    "number": "string",
    "date": "YYYY-MM-DD",
    "due_date": "YYYY-MM-DD | null",
    "payment_terms": "string | null"
  },
  "lines": [
    {
      "description": "string",
      "quantity": number | null,
      "unit_price": number | null,
      "total_ht": number,
      "tva_rate": number | null,
      "tva_amount": number | null,
      "total_ttc": number | null
    }
  ],
  "totals": {
    "total_ht": number,
    "total_tva": number,
    "total_ttc": number,
    "tva_details": [
      { "rate": number, "base": number, "amount": number }
    ]
  }
}`

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'Aucun fichier fourni' },
        { status: 400 }
      )
    }

    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')

    let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg'
    if (file.type === 'image/png') mediaType = 'image/png'
    else if (file.type === 'image/webp') mediaType = 'image/webp'

    // For PDFs, we send as document type
    const isPdf = file.type === 'application/pdf'

    const content: Anthropic.Messages.ContentBlockParam[] = isPdf
      ? [
          {
            type: 'document' as const,
            source: {
              type: 'base64' as const,
              media_type: 'application/pdf',
              data: base64,
            },
          },
          { type: 'text' as const, text: EXTRACTION_PROMPT },
        ]
      : [
          {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: mediaType,
              data: base64,
            },
          },
          { type: 'text' as const, text: EXTRACTION_PROMPT },
        ]

    const response = await anthropic.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    })

    const textBlock = response.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json(
        { success: false, error: "Pas de réponse textuelle de l'IA" },
        { status: 500 }
      )
    }

    // Parse JSON from response (handle potential markdown code blocks)
    let jsonText = textBlock.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const extraction: RawExtraction = JSON.parse(jsonText)

    return NextResponse.json({ success: true, data: extraction })
  } catch (error) {
    console.error('Extraction error:', error)
    const message = error instanceof Error ? error.message : 'Erreur inconnue'
    return NextResponse.json(
      { success: false, error: `Erreur d'extraction : ${message}` },
      { status: 500 }
    )
  }
}

// Type import for Anthropic namespace
import type Anthropic from '@anthropic-ai/sdk'
