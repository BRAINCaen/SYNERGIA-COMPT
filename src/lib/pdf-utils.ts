import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

export async function annotatePdfWithPCG(
  pdfBytes: Uint8Array,
  annotations: { lineDescription: string; pcgCode: string; pcgLabel: string; pageIndex?: number }[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes)
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const pages = pdfDoc.getPages()

  if (pages.length === 0) return pdfBytes

  // Add a summary page at the end
  const summaryPage = pdfDoc.addPage()
  const { width, height } = summaryPage.getSize()

  // Title
  summaryPage.drawText('VENTILATION COMPTABLE - SYNERGIA-COMPT', {
    x: 50,
    y: height - 50,
    size: 16,
    font: helveticaBold,
    color: rgb(0.09, 0.31, 0.84),
  })

  summaryPage.drawText(`Date d'annotation : ${new Date().toLocaleDateString('fr-FR')}`, {
    x: 50,
    y: height - 75,
    size: 10,
    font: helvetica,
    color: rgb(0.4, 0.4, 0.4),
  })

  // Separator line
  summaryPage.drawLine({
    start: { x: 50, y: height - 85 },
    end: { x: width - 50, y: height - 85 },
    thickness: 1,
    color: rgb(0.8, 0.8, 0.8),
  })

  // Table headers
  let yPosition = height - 110
  const colX = { code: 50, label: 130, desc: 300 }

  summaryPage.drawText('Compte PCG', {
    x: colX.code,
    y: yPosition,
    size: 10,
    font: helveticaBold,
    color: rgb(0.2, 0.2, 0.2),
  })
  summaryPage.drawText('Libellé compte', {
    x: colX.label,
    y: yPosition,
    size: 10,
    font: helveticaBold,
    color: rgb(0.2, 0.2, 0.2),
  })
  summaryPage.drawText('Description ligne', {
    x: colX.desc,
    y: yPosition,
    size: 10,
    font: helveticaBold,
    color: rgb(0.2, 0.2, 0.2),
  })

  yPosition -= 20

  // Annotation rows
  for (const annotation of annotations) {
    if (yPosition < 50) break // Don't overflow the page

    summaryPage.drawText(annotation.pcgCode, {
      x: colX.code,
      y: yPosition,
      size: 9,
      font: helveticaBold,
      color: rgb(0.09, 0.31, 0.84),
    })

    const truncatedLabel = truncateText(annotation.pcgLabel, 25)
    summaryPage.drawText(truncatedLabel, {
      x: colX.label,
      y: yPosition,
      size: 9,
      font: helvetica,
      color: rgb(0.3, 0.3, 0.3),
    })

    const truncatedDesc = truncateText(annotation.lineDescription, 40)
    summaryPage.drawText(truncatedDesc, {
      x: colX.desc,
      y: yPosition,
      size: 9,
      font: helvetica,
      color: rgb(0.3, 0.3, 0.3),
    })

    yPosition -= 18
  }

  // Footer
  summaryPage.drawText('Généré automatiquement par SYNERGIA-COMPT', {
    x: 50,
    y: 30,
    size: 8,
    font: helvetica,
    color: rgb(0.6, 0.6, 0.6),
  })

  return await pdfDoc.save()
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength - 3) + '...'
}

export async function getPdfPageCount(pdfBytes: Uint8Array): Promise<number> {
  const pdfDoc = await PDFDocument.load(pdfBytes)
  return pdfDoc.getPageCount()
}
