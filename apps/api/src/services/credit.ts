import { getDb } from '@aigc/db'
import { sql } from 'kysely'

function computeNextReset(period: string): Date {
  const now = new Date()
  if (period === 'weekly') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7)
  }
  // monthly: same day next month
  return new Date(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/**
 * Freeze credits from team pool. Checks member quota if set.
 * Uses FOR UPDATE locks to prevent race conditions.
 */
export async function freezeCredits(
  teamId: string,
  userId: string,
  amount: number,
): Promise<{ creditAccountId: string }> {
  const db = getDb()

  return await db.transaction().execute(async (trx: any) => {
    // 1. Lock the team credit account FIRST to serialize concurrent requests
    const account = await sql<{ id: string; balance: number; frozen_credits: number }>`
      SELECT id, balance, frozen_credits
      FROM credit_accounts
      WHERE team_id = ${teamId} AND owner_type = 'team'
      FOR UPDATE
    `.execute(trx)

    const row = account.rows[0]
    if (!row) {
      throw new Error('未找到团队积分账户')
    }

    if (row.balance - row.frozen_credits < amount) {
      throw new Error('团队积分余额不足')
    }

    // 2. Lock and check member quota (after team lock to prevent race)
    const member = await sql<{ credit_quota: number | null; credit_used: number; quota_period: string | null; quota_reset_at: string | null }>`
      SELECT credit_quota, credit_used, quota_period, quota_reset_at
      FROM team_members
      WHERE team_id = ${teamId} AND user_id = ${userId}
      FOR UPDATE
    `.execute(trx)

    const memberRow = member.rows[0]

    // Auto-reset credit_used if quota period has elapsed
    if (memberRow?.quota_period && memberRow?.quota_reset_at) {
      const resetAt = new Date(memberRow.quota_reset_at)
      if (new Date() >= resetAt) {
        const nextReset = computeNextReset(memberRow.quota_period)
        await trx.updateTable('team_members').set({
          credit_used: sql`0`,
          quota_reset_at: sql`${nextReset.toISOString()}::timestamptz`,
        }).where('team_id', '=', teamId).where('user_id', '=', userId).execute()
        memberRow.credit_used = 0
        memberRow.quota_reset_at = nextReset.toISOString()
      }
    }

    if (memberRow?.credit_quota !== null && memberRow?.credit_quota !== undefined) {
      if ((memberRow.credit_used ?? 0) + amount > memberRow.credit_quota) {
        throw new Error('个人积分配额已用尽，请联系团队负责人增加配额')
      }
    }

    // 3. Freeze from team pool
    await trx
      .updateTable('credit_accounts')
      .set({
        frozen_credits: sql`frozen_credits + ${amount}`,
      })
      .where('id', '=', row.id)
      .execute()

    // 4. Update member usage
    await trx
      .updateTable('team_members')
      .set({
        credit_used: sql`credit_used + ${amount}`,
      })
      .where('team_id', '=', teamId)
      .where('user_id', '=', userId)
      .execute()

    // 5. Ledger entry
    await trx
      .insertInto('credits_ledger')
      .values({
        credit_account_id: row.id,
        user_id: userId,
        amount: -amount,
        type: 'freeze',
        description: 'Credits frozen for image generation',
      })
      .execute()

    return { creditAccountId: row.id }
  })
}

/**
 * Confirm credits after successful task completion.
 */
export async function confirmCredits(
  creditAccountId: string,
  userId: string,
  amount: number,
  taskId?: string,
  batchId?: string,
): Promise<void> {
  const db = getDb()

  await db.transaction().execute(async (trx: any) => {
    await trx
      .updateTable('credit_accounts')
      .set({
        balance: sql`balance - ${amount}`,
        frozen_credits: sql`frozen_credits - ${amount}`,
        total_spent: sql`total_spent + ${amount}`,
      })
      .where('id', '=', creditAccountId)
      .execute()

    await trx
      .insertInto('credits_ledger')
      .values({
        credit_account_id: creditAccountId,
        user_id: userId,
        amount: -amount,
        type: 'confirm',
        task_id: taskId ?? null,
        batch_id: batchId ?? null,
        description: 'Credits confirmed for completed task',
      })
      .execute()
  })
}

/**
 * Refund credits after task failure.
 */
export async function refundCredits(
  teamId: string,
  creditAccountId: string,
  userId: string,
  amount: number,
  taskId?: string,
  batchId?: string,
): Promise<void> {
  const db = getDb()

  await db.transaction().execute(async (trx: any) => {
    // Unfreeze from team pool
    await trx
      .updateTable('credit_accounts')
      .set({
        frozen_credits: sql`frozen_credits - ${amount}`,
      })
      .where('id', '=', creditAccountId)
      .execute()

    // Decrement member usage (GREATEST prevents going below 0)
    await trx
      .updateTable('team_members')
      .set({
        credit_used: sql`GREATEST(credit_used - ${amount}, 0)`,
      })
      .where('team_id', '=', teamId)
      .where('user_id', '=', userId)
      .execute()

    await trx
      .insertInto('credits_ledger')
      .values({
        credit_account_id: creditAccountId,
        user_id: userId,
        amount,
        type: 'refund',
        task_id: taskId ?? null,
        batch_id: batchId ?? null,
        description: 'Credits refunded for failed task',
      })
      .execute()
  })
}
