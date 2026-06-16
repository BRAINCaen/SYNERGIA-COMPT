import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import anthropic, { CLASSIFICATION_MODEL, MAX_TOKENS } from '@/lib/anthropic'
import * as XLSX from 'xlsx'

/**
 * Extract the first complete JSON object from a Claude response, even if it
 * contains commentary, multiple objects, or markdown fencing. Throws on no JSON.
 */
function extractFirstJsonObject(raw: string): unknown {
  let text = raw.trim()
  // Strip ```json ... ``` fences
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }
  // Direct parse — works when the model returns clean JSON
  try {
    return JSON.parse(text)
  } catch { /* fall through */ }
  // Find first { ... } balanced object
  const start = text.indexOf('{')
  if (start < 0) throw new Error('Aucun JSON trouve dans la reponse IA')
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (escape) { escape = false; continue }
    if (c === '\\') { escape = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        const slice = text.slice(start, i + 1)
        return JSON.parse(slice)
      }
    }
  }
  throw new Error('JSON malforme dans la reponse IA')
}

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'Fichier manquant' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const base64 = buffer.toString('base64')

    const prompt = `Tu es un expert-comptable français. Analyse ce document PDF (facture de prestation, relevé TPE, bordereau de chèques, courrier de subvention, ticket de caisse, bordereau ANCV, etc.) et extrais les informations d'encaissement.

Réponds UNIQUEMENT en JSON valide, sans commentaire :
{
  "document_type": "encaissement" ou "subvention",
  "source": "tpe_virtuel" | "virement" | "tpe_sur_place" | "cheque" | "ancv" | "especes" | "billetterie" | "prestation" | "subvention",
  "entity_name": "nom du client, organisme ou payeur",
  "date": "YYYY-MM-DD",
  "description": "description courte du document/encaissement",
  "amount_ht": nombre HT (sans TVA), mettre le TTC si pas de TVA détaillée,
  "tva_rate": taux TVA principal en % (0 si pas de TVA ou exonéré),
  "amount_ttc": nombre TTC,
  "reference": "numéro de facture, référence ou null si absent",
  "items": [{"description": "ligne de détail", "amount": nombre}]
}

Règles :
- source "billetterie" = ventes de billets, escape game, activités loisirs
- source "prestation" = factures de prestations, team building, événementiel
- source "subvention" = courrier/notification de subvention publique
- source "tpe_virtuel" = paiement en ligne, e-commerce
- source "tpe_sur_place" = terminal de paiement physique
- source "virement" = virement bancaire reçu
- source "cheque" = paiement par chèque
- source "ancv" = chèques vacances ANCV
- source "especes" = paiement en espèces
- Si le document contient plusieurs lignes, les mettre dans items
- Montants en nombres avec point décimal (1234.56)
- Si le montant HT n'est pas explicite, calculer : amount_ht = amount_ttc / (1 + tva_rate/100)
- Si pas de TVA mentionnée, tva_rate = 0 et amount_ht = amount_ttc`

    // Determine content type based on file
    const fileType = file.type || ''
    const fileName = file.name?.toLowerCase() || ''
    const isImage = fileType.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif)$/.test(fileName)
    const isCsv = fileType === 'text/csv' || fileName.endsWith('.csv')
    const isExcel = fileType.includes('spreadsheet') || fileType.includes('excel') || /\.(xlsx?|xls)$/.test(fileName)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let content: any[]

    if (isCsv || isExcel) {
      // For CSV/Excel: send as text (Claude can't read binary Excel, but CSV is text)
      let textContent = ''
      if (isCsv) {
        // Try UTF-8, fallback to Latin-1
        textContent = new TextDecoder('utf-8').decode(buffer)
        if (textContent.includes('\ufffd')) {
          textContent = new TextDecoder('iso-8859-1').decode(buffer)
        }
      } else {
        // Excel : parse en CSV via xlsx pour que Claude puisse lire le contenu
        try {
          const workbook = XLSX.read(buffer, { type: 'buffer' })
          const sheets: string[] = []
          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName]
            const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ';', blankrows: false })
            if (csv.trim()) sheets.push(`=== Feuille : ${sheetName} ===\n${csv}`)
          }
          textContent = sheets.join('\n\n')
        } catch (e) {
          console.error('Excel parse error:', e)
          textContent = `[Echec lecture Excel: ${file.name}]`
        }
      }
      content = [
        { type: 'text', text: `Voici un fichier ${isCsv ? 'CSV' : 'Excel converti en CSV'} d'encaissements :\n\n${textContent.slice(0, 30000)}\n\n${prompt}` },
      ]
    } else if (isImage) {
      // For images: send as image
      let mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' = 'image/jpeg'
      if (fileType === 'image/png') mediaType = 'image/png'
      else if (fileType === 'image/webp') mediaType = 'image/webp'
      else if (fileType === 'image/gif') mediaType = 'image/gif'
      content = [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: prompt },
      ]
    } else {
      // Default: PDF
      content = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: prompt },
      ]
    }

    // Call Claude with retry on 429
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let response: any
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await (anthropic.messages.create as any)({
          model: CLASSIFICATION_MODEL,
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

    const textBlock = response.content.find((b: { type: string }) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'Pas de reponse IA' }, { status: 500 })
    }

    const data = extractFirstJsonObject(textBlock.text)
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('Extract revenue error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur extraction' },
      { status: 500 }
    )
  }
}
