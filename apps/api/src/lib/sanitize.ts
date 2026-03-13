/**
 * Strip HTML tags from text. Handles common bypass patterns that simple regex misses.
 * Decodes HTML entities, removes tags, and trims whitespace.
 */
export function stripHtml(input: string): string {
  return input
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Remove script/style blocks entirely
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Remove all HTML tags (handles attributes with quotes, event handlers, etc.)
    .replace(/<\/?[a-z][^>]*>/gi, '')
    // Decode common HTML entities
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    // Re-strip any tags that were hidden inside entities
    .replace(/<\/?[a-z][^>]*>/gi, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()
}
