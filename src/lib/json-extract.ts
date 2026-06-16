/**
 * Extract the first complete JSON object from a Claude (or any LLM) response,
 * even if it contains preamble text, commentary, multiple objects, or markdown
 * fencing. Used by all extraction routes to harden JSON.parse against the
 * model occasionally prefacing the output with text like "Je dois analyser...".
 *
 * Throws if no balanced JSON object is found.
 */
export function extractFirstJsonObject(raw: string): unknown {
  let text = (raw || '').trim()
  // Strip ```json ... ``` fences
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }
  // Direct parse — works when the model returns clean JSON
  try {
    return JSON.parse(text)
  } catch { /* fall through */ }
  // Find first balanced { ... } or [ ... ] value, respecting strings and escapes
  const objStart = text.indexOf('{')
  const arrStart = text.indexOf('[')
  let start = -1
  let open = '{'
  let close = '}'
  if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) {
    start = objStart
  } else if (arrStart >= 0) {
    start = arrStart
    open = '['
    close = ']'
  }
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
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) {
        const slice = text.slice(start, i + 1)
        return JSON.parse(slice)
      }
    }
  }
  throw new Error('JSON malforme dans la reponse IA')
}
