import type { Kysely } from 'kysely'

const DEFAULT_VIDEO_SEGMENT_MERGE_CREDITS = 3

function getInitialVideoSegmentMergeCredits(): number {
  const rawCredits = Number.parseInt(process.env.VIDEO_SEGMENT_MERGE_CREDITS ?? '', 10)
  return Number.isFinite(rawCredits) && rawCredits >= 0 ? rawCredits : DEFAULT_VIDEO_SEGMENT_MERGE_CREDITS
}

export async function up(db: Kysely<any>): Promise<void> {
  await db
    .insertInto('system_cost_configs')
    .values({
      key: 'video_segment_merge',
      label: '分段视频合成',
      description: '每次合成分段视频消耗的A豆',
      credit_cost: getInitialVideoSegmentMergeCredits(),
    })
    .onConflict((oc: any) => oc.column('key').doNothing())
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db
    .deleteFrom('system_cost_configs')
    .where('key', '=', 'video_segment_merge')
    .execute()
}
