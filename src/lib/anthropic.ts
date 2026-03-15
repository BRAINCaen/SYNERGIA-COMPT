import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export default anthropic

export const EXTRACTION_MODEL = 'claude-sonnet-4-20250514'
export const CLASSIFICATION_MODEL = 'claude-sonnet-4-20250514'
export const MAX_TOKENS = 4096
