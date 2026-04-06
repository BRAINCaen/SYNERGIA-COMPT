export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminDb, adminStorage } from '@/lib/firebase/admin'
import anthropic, { EXTRACTION_MODEL, MAX_TOKENS } from '@/lib/anthropic'
import { convertToEur } from '@/lib/currency'
import type Anthropic from '@anthropic-ai/sdk'

/**
 * Server-side batch rescan: finds invoices matching a filter and rescans them.
 * This runs server-side so no client timeout issues.
 * POST body: { filter: 'amazon' | 'multi_page' | 'all_classified' | 'no_lines', limit?: number }
 */

const EXTRACTION_PROMPT = `Tu es expert-comptable pour la SARL BOEHME (B.R.A.I.N. Escape Game, Mondeville 14).
Analyse ce document comptable et extrais TOUTES les informations.

MULTI-PAGES (TRÈS IMPORTANT) :
- Tu DOIS analyser TOUTES les pages du document
- Pour Amazon, chaque page peut lister des produits différents de la MÊME commande : additionne TOUT
- Le total TTC = somme de TOUTES les pages
- Cherche le "Total de la commande" ou "Order Total" sur la dernière page
- Chaque produit de chaque page doit être une ligne séparée

Extrais en JSON :
{
  "document_type": "expense | revenue",
  "is_credit_note": false,
  "revenue_source": null,
  "supplier": { "name": "string", "siret": "string | null" },
  "invoice": { "number": "string", "date": "YYYY-MM-DD", "currency": "EUR | USD | GBP" },
  "lines": [{ "description": "string", "quantity": null, "unit_price": null, "total_ht": 0, "tva_rate": null, "tva_amount": null, "total_ttc": null }],
  "totals": { "total_ht": 0, "total_tva": 0, "total_ttc": 0, "tva_details": [] }
}
Réponds UNIQUEMENT avec le JSON.`

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
    }

    const { filter = 'amazon', limit = 50 } = await request.json()

    // Get all invoices
    const snap = await adminDb
      .collection('invoices')
      .where('user_id', '==', decoded.uid)
      .get()

    // Filter based on criteria
    let toRescan = snap.docs.filter(doc => {
      const d = doc.data()
      if (!d.file_path) return false

      switch (filter) {
        case 'amazon':
          const name = ((d.supplier_name || '') + ' ' + (d.file_name || '')).toLowerCase()
          return name.includes('amazon')
        case 'no_lines': {
          // Invoices that have supplier but no lines saved
          return d.supplier_name && d.status !== 'pending'
        }
        case 'all_classified':
          return d.status === 'classified' || d.status === 'validated' || d.status === 'exported'
        default:
          return false
      }
    })

    // Limit
    toRescan = toRescan.slice(0, limit)

    if (toRescan.length === 0) {
      return NextResponse.json({ success: true, rescanned: 0, message: 'Aucune facture a rescanner' })
    }

    // Return immediately with the count, process in background won't work on serverless
    // Instead, just rescan the first few within the timeout
    let rescanned = 0
    const errors: string[] = []
    const bucket = adminStorage.bucket()

    for (const doc of toRescan) {
      const data = doc.data()

      try {
        // Download PDF from Storage
        const [fileBuffer] = await bucket.file(data.file_path).download()
        const base64 = fileBuffer.toString('base64')

        // Send to Claude
        const content: Anthropic.Messages.ContentBlockParam[] = [
          {
            type: 'document' as const,
            source: { type: 'base64' as const, media_type: 'application/pdf', data: base64 },
          },
          { type: 'text' as const, text: EXTRACTION_PROMPT },
        ]

        let response
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            response = await anthropic.messages.create({
              model: EXTRACTION_MODEL,
              max_tokens: MAX_TOKENS,
              messages: [{ role: 'user', content }],
            })
            break
          } catch (e: any) {
            if ((e?.status === 429 || e?.status === 529) && attempt < 1) {
              await new Promise(r => setTimeout(r, 10000))
              continue
            }
            throw e
          }
        }

        if (!response) continue

        const textBlock = response.content.find(b => b.type === 'text')
        if (!textBlock || textBlock.type !== 'text') continue

        let jsonText = textBlock.text.trim()
        if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
        }

        const extraction = JSON.parse(jsonText)

        // Currency conversion
        const currency = extraction.invoice?.currency || 'EUR'
        let totalTtcEur = null
        let totalHtEur = null
        let exchangeRate = null
        if (currency !== 'EUR' && extraction.totals?.total_ttc && extraction.invoice?.date) {
          const converted = await convertToEur(extraction.totals.total_ttc, currency, extraction.invoice.date)
          if (converted) {
            totalTtcEur = converted.amountEur
            exchangeRate = converted.rate
            if (extraction.totals?.total_ht) totalHtEur = Math.round(extraction.totals.total_ht * converted.rate * 100) / 100
          }
        }

        // Update invoice
        await adminDb.collection('invoices').doc(doc.id).update({
          document_type: extraction.document_type || 'expense',
          is_credit_note: extraction.is_credit_note || false,
          supplier_name: extraction.supplier?.name || data.supplier_name,
          supplier_siret: extraction.supplier?.siret || null,
          invoice_number: extraction.invoice?.number || null,
          invoice_date: extraction.invoice?.date || null,
          currency,
          total_ht: extraction.totals?.total_ht || null,
          total_tva: extraction.totals?.total_tva || null,
          total_ttc: extraction.totals?.total_ttc || null,
          total_ht_eur: totalHtEur,
          total_ttc_eur: totalTtcEur,
          exchange_rate: exchangeRate,
          raw_extraction: extraction,
          status: 'classified',
          updated_at: new Date().toISOString(),
        })

        // Save lines
        if (extraction.lines?.length > 0) {
          // Delete old lines first
          const oldLines = await adminDb.collection('invoice_lines').where('invoice_id', '==', doc.id).get()
          if (!oldLines.empty) {
            const delBatch = adminDb.batch()
            oldLines.docs.forEach(d => delBatch.delete(d.ref))
            await delBatch.commit()
          }

          // Save new lines
          const linesBatch = adminDb.batch()
          for (const line of extraction.lines) {
            const ref = adminDb.collection('invoice_lines').doc()
            linesBatch.set(ref, {
              id: ref.id,
              invoice_id: doc.id,
              description: line.description || '',
              quantity: line.quantity || 1,
              unit_price: line.unit_price || line.total_ht,
              total_ht: line.total_ht || 0,
              tva_rate: line.tva_rate || null,
              tva_amount: line.tva_amount || null,
              total_ttc: line.total_ttc || null,
              pcg_code: null,
              pcg_label: null,
              confidence_score: null,
              manually_corrected: false,
              journal_code: 'AC',
              reasoning: null,
              is_immobilization: false,
              amortization_rate: null,
              classification_method: null,
            })
          }
          await linesBatch.commit()
        }

        rescanned++
      } catch (e) {
        console.error(`Rescan error for ${doc.id}:`, e instanceof Error ? e.message : e)
        errors.push(doc.id)
      }
    }

    // Batch rename after rescan
    const allDocs = await adminDb.collection('invoices').where('user_id', '==', decoded.uid).get()
    const now = new Date().toISOString()
    const renameBatch = adminDb.batch()
    let renamed = 0
    for (const d of allDocs.docs) {
      const inv = d.data()
      const supplier = typeof inv.supplier_name === 'string' ? inv.supplier_name.trim() : ''
      if (!supplier) continue
      const ttc = typeof inv.total_ttc === 'number' ? inv.total_ttc : parseFloat(inv.total_ttc)
      const parts: string[] = []
      const clean = supplier.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9\s]/g, '').replace(/\s+/g, '_').slice(0, 40)
      if (clean) parts.push(clean)
      if (!isNaN(ttc) && ttc > 0) parts.push(`${ttc.toFixed(2).replace('.', ',')}EUR`)
      const date = (inv.invoice_date || '').slice(0, 10).replace(/-/g, '')
      if (/^\d{8}$/.test(date)) parts.push(date)
      const num = (inv.invoice_number || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 30)
      if (num) parts.push(num)
      if (parts.length === 0) continue
      const ext = (inv.file_name || '').includes('.') ? inv.file_name.split('.').pop()?.toLowerCase() || 'pdf' : 'pdf'
      const newName = `${parts.join('-')}.${ext}`
      if (newName !== inv.file_name) {
        renameBatch.update(d.ref, { file_name: newName, updated_at: now })
        renamed++
      }
    }
    if (renamed > 0) await renameBatch.commit()

    return NextResponse.json({
      success: true,
      rescanned,
      renamed,
      errors: errors.length,
      total_found: toRescan.length,
    })
  } catch (error) {
    console.error('Batch rescan error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur serveur' }, { status: 500 })
  }
}
