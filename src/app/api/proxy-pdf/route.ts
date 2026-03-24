import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/firebase/auth-helper'
import { adminStorage } from '@/lib/firebase/admin'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyAuth(request)
    if (!decoded) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    // Support both: ?url=... (signed URL) and ?path=... (Firebase Storage path)
    const url = request.nextUrl.searchParams.get('url')
    const path = request.nextUrl.searchParams.get('path')

    let data: Buffer | Uint8Array

    if (path) {
      // Download from Firebase Storage using Admin SDK
      const bucket = adminStorage.bucket()
      const fileRef = bucket.file(path)
      const [fileBuffer] = await fileRef.download()
      data = fileBuffer
    } else if (url) {
      // Download from URL (for signed URLs from invoice fileUrl)
      const response = await fetch(url)
      if (!response.ok) {
        return NextResponse.json({ error: 'Impossible de télécharger le PDF' }, { status: 502 })
      }
      data = new Uint8Array(await response.arrayBuffer())
    } else {
      return NextResponse.json({ error: 'Paramètre url ou path requis' }, { status: 400 })
    }

    // Detect content type from path
    const filePath = path || url || ''
    let contentType = 'application/octet-stream'
    if (filePath.endsWith('.pdf')) contentType = 'application/pdf'
    else if (filePath.endsWith('.csv')) contentType = 'text/csv'
    else if (filePath.endsWith('.xlsx') || filePath.endsWith('.xls')) contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

    return new NextResponse(data as unknown as BodyInit, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(data.length),
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (error) {
    console.error('Proxy PDF error:', error)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
