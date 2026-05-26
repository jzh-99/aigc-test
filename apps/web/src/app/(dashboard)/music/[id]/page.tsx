import { redirect } from 'next/navigation'

export default function LegacyMusicDetailPage({ params }: { params: { id: string } }) {
  redirect(`/toby-studio/music/${params.id}`)
}
