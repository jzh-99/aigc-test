import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await sql`UPDATE credits_ledger SET description = '图片生成成功' WHERE description = 'Image generation confirmed'`.execute(db)
  await sql`UPDATE credits_ledger SET description = regexp_replace(description, '^Image generation failed: ', '图片生成失败：') WHERE description LIKE 'Image generation failed:%'`.execute(db)

  await sql`UPDATE credits_ledger SET description = '视频生成成功' WHERE description = 'Video generation confirmed'`.execute(db)
  await sql`UPDATE credits_ledger SET description = regexp_replace(description, '^Video generation failed: ', '视频生成失败：') WHERE description LIKE 'Video generation failed:%'`.execute(db)
  await sql`UPDATE credits_ledger SET description = regexp_replace(description, '^Video submit failed: ', '视频任务提交失败：') WHERE description LIKE 'Video submit failed:%'`.execute(db)

  await sql`UPDATE credits_ledger SET description = '音乐生成成功' WHERE description = 'Music generation confirmed'`.execute(db)
  await sql`UPDATE credits_ledger SET description = regexp_replace(description, '^Music generation failed: ', '音乐生成失败：') WHERE description LIKE 'Music generation failed:%'`.execute(db)
  await sql`UPDATE credits_ledger SET description = '音乐音色克隆成功' WHERE description = 'Music voice clone confirmed'`.execute(db)
  await sql`UPDATE credits_ledger SET description = regexp_replace(description, '^Music voice clone failed: ', '音乐音色克隆失败：') WHERE description LIKE 'Music voice clone failed:%'`.execute(db)

  await sql`UPDATE credits_ledger SET description = '数字人生成成功' WHERE description = 'Avatar generation confirmed'`.execute(db)
  await sql`UPDATE credits_ledger SET description = regexp_replace(description, '^Avatar generation failed: ', '数字人生成失败：') WHERE description LIKE 'Avatar generation failed:%'`.execute(db)
  await sql`UPDATE credits_ledger SET description = regexp_replace(description, '^Avatar generation failed to submit: ', '数字人任务提交失败：') WHERE description LIKE 'Avatar generation failed to submit:%'`.execute(db)

  await sql`UPDATE credits_ledger SET description = '动作模仿生成成功' WHERE description = 'Action Imitation generation confirmed'`.execute(db)
  await sql`UPDATE credits_ledger SET description = regexp_replace(description, '^Action Imitation failed: ', '动作模仿生成失败：') WHERE description LIKE 'Action Imitation failed:%'`.execute(db)
  await sql`UPDATE credits_ledger SET description = regexp_replace(description, '^Action Imitation failed to submit: ', '动作模仿任务提交失败：') WHERE description LIKE 'Action Imitation failed to submit:%'`.execute(db)

  await sql`UPDATE credits_ledger SET description = '图片生成冻结积分' WHERE description = 'Credits frozen for image generation'`.execute(db)
  await sql`UPDATE credits_ledger SET description = '任务完成确认扣费' WHERE description = 'Credits confirmed for completed task'`.execute(db)
  await sql`UPDATE credits_ledger SET description = '任务失败退回积分' WHERE description = 'Credits refunded for failed task'`.execute(db)
  await sql`UPDATE credits_ledger SET description = '团队初始A豆' WHERE description = 'Initial team credits'`.execute(db)
  await sql`UPDATE credits_ledger SET description = '管理员充值A豆' WHERE description = 'Admin top-up'`.execute(db)
  await sql`UPDATE credits_ledger SET description = '管理员扣减A豆' WHERE description = 'Admin deduction'`.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`UPDATE credits_ledger SET description = 'Image generation confirmed' WHERE description = '图片生成成功'`.execute(db)
  await sql`UPDATE credits_ledger SET description = regexp_replace(description, '^图片生成失败：', 'Image generation failed: ') WHERE description LIKE '图片生成失败：%'`.execute(db)

  await sql`UPDATE credits_ledger SET description = 'Video generation confirmed' WHERE description = '视频生成成功'`.execute(db)
  await sql`UPDATE credits_ledger SET description = regexp_replace(description, '^视频生成失败：', 'Video generation failed: ') WHERE description LIKE '视频生成失败：%'`.execute(db)
  await sql`UPDATE credits_ledger SET description = regexp_replace(description, '^视频任务提交失败：', 'Video submit failed: ') WHERE description LIKE '视频任务提交失败：%'`.execute(db)

  await sql`UPDATE credits_ledger SET description = 'Music generation confirmed' WHERE description = '音乐生成成功'`.execute(db)
  await sql`UPDATE credits_ledger SET description = regexp_replace(description, '^音乐生成失败：', 'Music generation failed: ') WHERE description LIKE '音乐生成失败：%'`.execute(db)
  await sql`UPDATE credits_ledger SET description = 'Music voice clone confirmed' WHERE description = '音乐音色克隆成功'`.execute(db)
  await sql`UPDATE credits_ledger SET description = regexp_replace(description, '^音乐音色克隆失败：', 'Music voice clone failed: ') WHERE description LIKE '音乐音色克隆失败：%'`.execute(db)

  await sql`UPDATE credits_ledger SET description = 'Avatar generation confirmed' WHERE description = '数字人生成成功'`.execute(db)
  await sql`UPDATE credits_ledger SET description = regexp_replace(description, '^数字人生成失败：', 'Avatar generation failed: ') WHERE description LIKE '数字人生成失败：%'`.execute(db)
  await sql`UPDATE credits_ledger SET description = regexp_replace(description, '^数字人任务提交失败：', 'Avatar generation failed to submit: ') WHERE description LIKE '数字人任务提交失败：%'`.execute(db)

  await sql`UPDATE credits_ledger SET description = 'Action Imitation generation confirmed' WHERE description = '动作模仿生成成功'`.execute(db)
  await sql`UPDATE credits_ledger SET description = regexp_replace(description, '^动作模仿生成失败：', 'Action Imitation failed: ') WHERE description LIKE '动作模仿生成失败：%'`.execute(db)
  await sql`UPDATE credits_ledger SET description = regexp_replace(description, '^动作模仿任务提交失败：', 'Action Imitation failed to submit: ') WHERE description LIKE '动作模仿任务提交失败：%'`.execute(db)

  await sql`UPDATE credits_ledger SET description = 'Credits frozen for image generation' WHERE description = '图片生成冻结积分'`.execute(db)
  await sql`UPDATE credits_ledger SET description = 'Credits confirmed for completed task' WHERE description = '任务完成确认扣费'`.execute(db)
  await sql`UPDATE credits_ledger SET description = 'Credits refunded for failed task' WHERE description = '任务失败退回积分'`.execute(db)
  await sql`UPDATE credits_ledger SET description = 'Initial team credits' WHERE description = '团队初始A豆'`.execute(db)
  await sql`UPDATE credits_ledger SET description = 'Admin top-up' WHERE description = '管理员充值A豆'`.execute(db)
  await sql`UPDATE credits_ledger SET description = 'Admin deduction' WHERE description = '管理员扣减A豆'`.execute(db)
}
