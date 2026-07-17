export function pastePlainTextIntoContentEditable(event: React.ClipboardEvent<HTMLElement>): void {
  const text = event.clipboardData.getData('text/plain')
  if (!text) return

  event.preventDefault()

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return

  selection.deleteFromDocument()
  const range = selection.getRangeAt(0)
  const textNode = document.createTextNode(text)
  range.insertNode(textNode)
  range.setStartAfter(textNode)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}
