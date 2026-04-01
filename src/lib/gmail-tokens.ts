import { adminDb } from '@/lib/firebase/admin'

interface StoredTokens {
  access_token: string
  refresh_token?: string | null
  expiry_date?: number | null
}

/**
 * Get a valid Gmail access token, refreshing if expired.
 * Returns the access token string or null if refresh fails.
 */
export async function getValidGmailToken(uid: string): Promise<string | null> {
  const tokenDoc = await adminDb.collection('gmailTokens').doc(uid).get()
  if (!tokenDoc.exists) return null

  const tokenData = tokenDoc.data() as StoredTokens
  if (!tokenData.access_token) return null

  // Check if token is expired (with 5 min buffer)
  const isExpired = tokenData.expiry_date && tokenData.expiry_date < Date.now() + 5 * 60 * 1000

  if (!isExpired) {
    return tokenData.access_token
  }

  // Token expired — refresh it
  if (!tokenData.refresh_token) {
    return null // Can't refresh without refresh_token
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return null

  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokenData.refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  const refreshData = await refreshRes.json()

  if (!refreshRes.ok || !refreshData.access_token) {
    console.error('Gmail token refresh failed:', refreshData.error || refreshRes.status)
    return null
  }

  // Update stored tokens
  await adminDb.collection('gmailTokens').doc(uid).update({
    access_token: refreshData.access_token,
    expiry_date: Date.now() + (refreshData.expires_in || 3600) * 1000,
    updated_at: new Date().toISOString(),
  })

  return refreshData.access_token
}
