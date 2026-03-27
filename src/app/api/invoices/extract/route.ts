import { NextRequest, NextResponse } from 'next/server'
import anthropic, { EXTRACTION_MODEL, MAX_TOKENS } from '@/lib/anthropic'
import type { RawExtraction } from '@/types'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

const EXTRACTION_PROMPT = `Tu es expert-comptable pour la SARL BOEHME (B.R.A.I.N. Escape Game, Mondeville 14).
SIRET : 82322711100023.

Analyse ce document comptable et extrais TOUTES les informations.
IMPORTANT : Détermine si c'est une DÉPENSE (facture d'achat, nous sommes le client/acheteur) ou une RECETTE (facture de vente, ticket de caisse, reçu TPE, bordereau de remise, avoir, etc. où nous sommes le vendeur/prestataire).

Indices pour RECETTE :
- BOEHME / B.R.A.I.N. / BRAIN ESCAPE est l'émetteur (vendeur)
- Ticket de caisse, reçu TPE, bordereau de remise chèques/ANCV, relevé de ventes
- Encaissement (virement reçu, CB reçu, chèque reçu, ANCV)

Indices pour DÉPENSE :
- BOEHME / B.R.A.I.N. est le destinataire (acheteur/client)
- Facture d'un fournisseur, reçu d'achat

Pour les recettes, identifie aussi la source : "tpe_virtuel", "virement", "tpe_sur_place", "cheque", "ancv", "especes" ou null si indéterminé.

Extrais :
1. **Type** : "expense" ou "revenue"
2. **Source recette** (si revenue) : tpe_virtuel, virement, tpe_sur_place, cheque, ancv, especes, ou null
3. **Émetteur/Fournisseur** : nom, adresse, SIRET, TVA intra, téléphone, email
4. **Document** : numéro, date (YYYY-MM-DD), date d'échéance, conditions de paiement
5. **Lignes** : description, quantité, prix unitaire HT, total HT, taux TVA (%), montant TVA, total TTC
6. **Totaux** : total HT, total TVA, total TTC, détail TVA par taux

RÈGLES STRICTES :
- Montants = nombres (jamais de symboles € ou espaces)
- Dates au format ISO 8601 YYYY-MM-DD
- null si information illisible ou absente
- Pour les taux de TVA, utilise le pourcentage (ex: 20 pour 20%)
- Vérifier : somme des lignes ≈ total document
- Si multi-pages, analyser TOUTES les pages

Réponds UNIQUEMENT avec le JSON suivant (pas de texte autour) :
{
  "document_type": "expense | revenue",
  "revenue_source": "tpe_virtuel | virement | tpe_sur_place | cheque | ancv | especes | null",
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
    // Edge-compatible base64 encoding (no Buffer in edge runtime)
    const uint8 = new Uint8Array(bytes)
    let binary = ''
    for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i])
    const base64 = btoa(binary)

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

    // Retry on 429/529 errors
    let response
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await anthropic.messages.create({
          model: EXTRACTION_MODEL,
          max_tokens: MAX_TOKENS,
          messages: [{ role: 'user', content }],
        })
        break
      } catch (e: any) {
        if ((e?.status === 429 || e?.status === 529) && attempt < 2) {
          await new Promise(r => setTimeout(r, 10000 * (attempt + 1)))
          continue
        }
        throw e
      }
    }
    if (!response) throw new Error('Pas de réponse après 3 tentatives')

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
