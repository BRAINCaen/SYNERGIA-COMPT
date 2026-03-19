import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

// BOEHME brand colors (converted to 0-1 range for pdf-lib)
const BOEHME_GREEN = rgb(0, 200 / 255, 150 / 255) // #00C896
const BOEHME_DARK = rgb(13 / 255, 17 / 255, 23 / 255) // #0D1117
const BOEHME_CARD = rgb(22 / 255, 27 / 255, 34 / 255) // #161B22
const BOEHME_ORANGE = rgb(255 / 255, 140 / 255, 66 / 255) // #FF8C42
const BOEHME_RED = rgb(255 / 255, 59 / 255, 48 / 255) // #FF3B30
const WHITE = rgb(1, 1, 1)
const GRAY_LIGHT = rgb(0.7, 0.7, 0.7)
const GRAY_MID = rgb(0.5, 0.5, 0.5)

interface AnnotationLine {
  lineDescription: string
  pcgCode: string
  pcgLabel: string
  reasoning?: string | null
  totalHt?: number | null
  tvaRate?: number | null
  journalCode?: string | null
  confidenceScore?: number | null
  isImmobilization?: boolean
  classificationMethod?: string | null
  pageIndex?: number
}

/**
 * Get confidence band color:
 * - Green (≥ 85%) — high confidence
 * - Orange (65-84%) — medium confidence
 * - Red (< 65%) — low confidence
 */
function getConfidenceColor(score: number | null | undefined) {
  if (score == null) return GRAY_MID
  if (score >= 0.85) return BOEHME_GREEN
  if (score >= 0.65) return BOEHME_ORANGE
  return BOEHME_RED
}

function getConfidenceLabel(score: number | null | undefined): string {
  if (score == null) return '—'
  return `${Math.round(score * 100)}%`
}

export async function annotatePdfWithPCG(
  pdfBytes: Uint8Array,
  annotations: AnnotationLine[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes)
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)
  const courier = await pdfDoc.embedFont(StandardFonts.Courier)
  const pages = pdfDoc.getPages()

  if (pages.length === 0) return pdfBytes

  // === STEP 1: Add annotation frame on the FIRST page ===
  const firstPage = pages[0]
  const { width: pw, height: ph } = firstPage.getSize()

  const frameMargin = 20
  const frameWidth = pw - frameMargin * 2
  const lineHeight = 14
  const headerHeight = 30
  const reasoningLineHeight = 11

  let neededHeight = headerHeight + 10
  for (const ann of annotations) {
    neededHeight += lineHeight + 4
    if (ann.reasoning) {
      neededHeight += reasoningLineHeight + 2
    }
  }
  neededHeight += 20

  const maxFrameOnPage = ph * 0.4
  const drawOnFirstPage = neededHeight <= maxFrameOnPage

  if (drawOnFirstPage) {
    drawAnnotationFrame(firstPage, annotations, {
      x: frameMargin,
      y: frameMargin,
      width: frameWidth,
      height: neededHeight,
      helveticaBold,
      helvetica,
      helveticaOblique,
      courier,
    })
  }

  // === STEP 2: Full BOEHME summary page at the end ===
  const summaryPage = pdfDoc.addPage()
  const { width, height } = summaryPage.getSize()

  // Dark background
  summaryPage.drawRectangle({
    x: 0, y: 0, width, height,
    color: BOEHME_DARK,
  })

  // Header bar with BOEHME green accent
  summaryPage.drawRectangle({
    x: 0, y: height - 70, width, height: 70,
    color: BOEHME_CARD,
  })

  // Green accent line at top
  summaryPage.drawRectangle({
    x: 0, y: height - 3, width, height: 3,
    color: BOEHME_GREEN,
  })

  summaryPage.drawText('VENTILATION COMPTABLE — BOEHME', {
    x: 50, y: height - 30,
    size: 16, font: helveticaBold, color: BOEHME_GREEN,
  })

  summaryPage.drawText('SYNERGIA-COMPT | B.R.A.I.N. Escape & Quiz Game', {
    x: 50, y: height - 48,
    size: 9, font: helvetica, color: GRAY_LIGHT,
  })

  summaryPage.drawText(`Annoté le ${new Date().toLocaleDateString('fr-FR')}`, {
    x: width - 180, y: height - 40,
    size: 9, font: helvetica, color: GRAY_MID,
  })

  // Legend for confidence colors
  const legendY = height - 85
  const legendItems = [
    { label: '≥ 85%', color: BOEHME_GREEN },
    { label: '65-84%', color: BOEHME_ORANGE },
    { label: '< 65%', color: BOEHME_RED },
  ]
  summaryPage.drawText('Confiance :', {
    x: 50, y: legendY, size: 7, font: helveticaBold, color: GRAY_LIGHT,
  })
  let legendX = 105
  for (const item of legendItems) {
    summaryPage.drawRectangle({
      x: legendX, y: legendY - 1, width: 8, height: 8,
      color: item.color,
    })
    summaryPage.drawText(item.label, {
      x: legendX + 11, y: legendY, size: 7, font: helvetica, color: GRAY_LIGHT,
    })
    legendX += 50
  }

  // Table headers
  let yPos = height - 105
  const cols = { num: 50, conf: 68, code: 100, label: 170, desc: 310, amount: 460, journal: 520 }

  // Header row background
  summaryPage.drawRectangle({
    x: 40, y: yPos - 5, width: width - 80, height: 20,
    color: BOEHME_CARD,
  })

  const headerTexts = [
    { text: '#', x: cols.num },
    { text: 'Conf.', x: cols.conf },
    { text: 'Compte', x: cols.code },
    { text: 'Libellé compte', x: cols.label },
    { text: 'Description', x: cols.desc },
    { text: 'HT', x: cols.amount },
    { text: 'Jnl', x: cols.journal },
  ]
  for (const h of headerTexts) {
    summaryPage.drawText(h.text, {
      x: h.x, y: yPos, size: 7, font: helveticaBold, color: BOEHME_GREEN,
    })
  }

  yPos -= 25

  // Rows
  for (let i = 0; i < annotations.length; i++) {
    const ann = annotations[i]
    if (yPos < 60) break

    const confColor = getConfidenceColor(ann.confidenceScore)
    const rowHeight = ann.reasoning ? 32 : 18

    // Alternating row background
    if (i % 2 === 0) {
      summaryPage.drawRectangle({
        x: 40, y: yPos - 5, width: width - 80, height: rowHeight,
        color: rgb(22 / 255, 27 / 255, 34 / 255), // BOEHME_CARD
      })
    }

    // Confidence color band (left edge indicator)
    summaryPage.drawRectangle({
      x: 40, y: yPos - 5, width: 3, height: rowHeight,
      color: confColor,
    })

    // Line number
    summaryPage.drawText(`${i + 1}`, {
      x: cols.num, y: yPos, size: 7, font: helvetica, color: GRAY_MID,
    })

    // Confidence score
    summaryPage.drawText(getConfidenceLabel(ann.confidenceScore), {
      x: cols.conf, y: yPos, size: 7, font: courier, color: confColor,
    })

    // PCG Code (green mono)
    summaryPage.drawText(ann.pcgCode, {
      x: cols.code, y: yPos, size: 8, font: courier, color: BOEHME_GREEN,
    })

    // Account label
    summaryPage.drawText(truncateText(ann.pcgLabel, 24), {
      x: cols.label, y: yPos, size: 7, font: helvetica, color: GRAY_LIGHT,
    })

    // Description
    summaryPage.drawText(truncateText(ann.lineDescription, 24), {
      x: cols.desc, y: yPos, size: 7, font: helvetica, color: WHITE,
    })

    // Amount
    if (ann.totalHt != null) {
      summaryPage.drawText(`${ann.totalHt.toFixed(2)} €`, {
        x: cols.amount, y: yPos, size: 7, font: courier, color: WHITE,
      })
    }

    // Journal
    if (ann.journalCode) {
      summaryPage.drawText(ann.journalCode, {
        x: cols.journal, y: yPos, size: 7, font: helvetica, color: GRAY_MID,
      })
    }

    // Immobilization indicator
    if (ann.isImmobilization) {
      summaryPage.drawText('IMMO', {
        x: width - 70, y: yPos, size: 6, font: helveticaBold, color: BOEHME_ORANGE,
      })
    }

    yPos -= 15

    // Reasoning in italic
    if (ann.reasoning) {
      summaryPage.drawText(`→ ${truncateText(ann.reasoning, 85)}`, {
        x: cols.code, y: yPos, size: 6, font: helveticaOblique, color: GRAY_MID,
      })
      yPos -= 14
    }

    yPos -= 3
  }

  // Footer
  summaryPage.drawLine({
    start: { x: 40, y: 45 }, end: { x: width - 40, y: 45 },
    thickness: 0.5, color: rgb(48 / 255, 54 / 255, 61 / 255), // dark-border
  })
  summaryPage.drawText('SYNERGIA-COMPT — SARL BOEHME (B.R.A.I.N.) — Classification IA validée par l\'utilisateur', {
    x: 50, y: 30, size: 7, font: helveticaOblique, color: GRAY_MID,
  })

  return await pdfDoc.save()
}

function drawAnnotationFrame(
  page: ReturnType<typeof PDFDocument.prototype.addPage>,
  annotations: AnnotationLine[],
  opts: {
    x: number
    y: number
    width: number
    height: number
    helveticaBold: Awaited<ReturnType<typeof PDFDocument.prototype.embedFont>>
    helvetica: Awaited<ReturnType<typeof PDFDocument.prototype.embedFont>>
    helveticaOblique: Awaited<ReturnType<typeof PDFDocument.prototype.embedFont>>
    courier: Awaited<ReturnType<typeof PDFDocument.prototype.embedFont>>
  }
) {
  const { x, y, width, height, helveticaBold, helvetica, helveticaOblique, courier } = opts

  // Dark frame background
  page.drawRectangle({
    x, y, width, height,
    color: rgb(13 / 255, 17 / 255, 23 / 255), // BOEHME_DARK
    borderColor: BOEHME_GREEN,
    borderWidth: 1.5,
  })

  // Header bar
  page.drawRectangle({
    x: x + 1, y: y + height - 24, width: width - 2, height: 23,
    color: rgb(22 / 255, 27 / 255, 34 / 255), // BOEHME_CARD
  })

  // Green accent on header
  page.drawRectangle({
    x: x + 1, y: y + height - 2, width: width - 2, height: 2,
    color: BOEHME_GREEN,
  })

  page.drawText('VENTILATION COMPTABLE — BOEHME / SYNERGIA-COMPT', {
    x: x + 8, y: y + height - 18,
    size: 7, font: helveticaBold, color: BOEHME_GREEN,
  })

  let lineY = y + height - 40

  for (const ann of annotations) {
    if (lineY < y + 15) break

    const confColor = getConfidenceColor(ann.confidenceScore)

    // Confidence color dot
    page.drawRectangle({
      x: x + 5, y: lineY - 1, width: 5, height: 8,
      color: confColor,
    })

    // Confidence %
    page.drawText(getConfidenceLabel(ann.confidenceScore), {
      x: x + 13, y: lineY, size: 6, font: courier, color: confColor,
    })

    // PCG Code (green, mono)
    page.drawText(ann.pcgCode, {
      x: x + 42, y: lineY, size: 7, font: courier, color: BOEHME_GREEN,
    })

    // Label
    page.drawText(truncateText(ann.pcgLabel, 25), {
      x: x + 95, y: lineY, size: 6, font: helvetica, color: GRAY_LIGHT,
    })

    // Description
    page.drawText(truncateText(ann.lineDescription, 28), {
      x: x + 220, y: lineY, size: 6, font: helvetica, color: WHITE,
    })

    // Amount
    if (ann.totalHt != null) {
      page.drawText(`${ann.totalHt.toFixed(2)} €`, {
        x: x + width - 65, y: lineY, size: 6, font: courier, color: WHITE,
      })
    }

    lineY -= 12

    // Reasoning in italic
    if (ann.reasoning) {
      page.drawText(`→ ${truncateText(ann.reasoning, 75)}`, {
        x: x + 12, y: lineY, size: 5, font: helveticaOblique, color: GRAY_MID,
      })
      lineY -= 10
    }

    lineY -= 4
  }
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength - 3) + '...'
}

export async function getPdfPageCount(pdfBytes: Uint8Array): Promise<number> {
  const pdfDoc = await PDFDocument.load(pdfBytes)
  return pdfDoc.getPageCount()
}
