// Canvas editor uses the normal AppShell (sidebar + topbar),
// but the page itself fills the remaining space with no padding.
// We override the main area padding by wrapping in a -m-4 md:-m-6 trick
// so the canvas bleeds to the edges of the content area.
export default function CanvasEditorLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
