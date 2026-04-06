/**
 * Convert a foreign currency amount to EUR using ECB rates via frankfurter.app
 * Free API, no key needed, based on European Central Bank rates.
 */
export async function convertToEur(
  amount: number,
  fromCurrency: string,
  date: string // YYYY-MM-DD
): Promise<{ amountEur: number; rate: number } | null> {
  if (!amount || !fromCurrency || fromCurrency === 'EUR') return null

  try {
    // Use the invoice date for historical rate
    const dateStr = date.slice(0, 10)

    // frankfurter.app provides ECB rates (free, no API key)
    const res = await fetch(
      `https://api.frankfurter.app/${dateStr}?from=${fromCurrency.toUpperCase()}&to=EUR&amount=${amount}`,
      { signal: AbortSignal.timeout(5000) }
    )

    if (!res.ok) {
      // Try with latest rate as fallback
      const fallback = await fetch(
        `https://api.frankfurter.app/latest?from=${fromCurrency.toUpperCase()}&to=EUR&amount=${amount}`,
        { signal: AbortSignal.timeout(5000) }
      )
      if (!fallback.ok) return null
      const data = await fallback.json()
      const eurAmount = data.rates?.EUR
      if (!eurAmount) return null
      return { amountEur: Math.round(eurAmount * 100) / 100, rate: eurAmount / amount }
    }

    const data = await res.json()
    const eurAmount = data.rates?.EUR
    if (!eurAmount) return null

    return {
      amountEur: Math.round(eurAmount * 100) / 100,
      rate: Math.round((eurAmount / amount) * 10000) / 10000,
    }
  } catch (e) {
    console.error('Currency conversion error:', e)
    return null
  }
}
