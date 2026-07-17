import type { FastifyPluginAsync } from 'fastify'
import { getDb } from '@aigc/db'
import bcrypt from 'bcryptjs'
import { teamRoleGuard } from '../../plugins/guards.js'

const route: FastifyPluginAsync = async (app) => {
  // POST /teams/:id/members/batch — 批量创建成员（设置默认密码）
  app.post<{
    Params: { id: string }
    Body: {
      identifiers: string[]
      role?: 'editor' | 'viewer'
      credit_quota?: number
      default_password: string
    }
  }>('/teams/:id/members/batch', {
    preHandler: teamRoleGuard('owner'),
    schema: {
      body: {
        type: 'object',
        required: ['identifiers', 'default_password'],
        properties: {
          identifiers: {
            type: 'array',
            items: { type: 'string', maxLength: 254 },
            minItems: 1,
            maxItems: 50,
          },
          role: { type: 'string', enum: ['editor', 'viewer'] },
          credit_quota: { type: 'number', minimum: 0, maximum: 1000000 },
          default_password: { type: 'string', minLength: 6, maxLength: 50 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { identifiers, role = 'editor', credit_quota = 1000, default_password } = request.body
    const teamId = request.params.id
    const db = getDb()

    // 所有用户共用同一个密码哈希
    const passwordHash = await bcrypt.hash(default_password, 10)

    interface BatchResult {
      identifier: string
      status: 'success' | 'failed' | 'exists'
      user_id?: string
      workspace_id?: string
      workspace_name?: string
      username?: string
      error?: string
    }

    const results: BatchResult[] = []
    let successCount = 0
    let failedCount = 0
    let existsCount = 0

    // 辅助函数：生成唯一用户名
    async function generateUsername(baseUsername: string): Promise<string> {
      let username = baseUsername
      let suffix = 1
      while (true) {
        const existing = await db
          .selectFrom('users')
          .select('id')
          .where('username', '=', username)
          .executeTakeFirst()
        if (!existing) return username
        username = `${baseUsername}_${suffix++}`
      }
    }

    // 逐个处理标识符
    for (const rawIdentifier of identifiers) {
      const identifier = rawIdentifier.trim()
      if (!identifier) {
        results.push({ identifier, status: 'failed', error: '标识符为空' })
        failedCount++
        continue
      }

      try {
        const isEmail = identifier.includes('@')
        const isPhone = /^\d{11}$/.test(identifier)

        if (!isEmail && !isPhone) {
          results.push({ identifier, status: 'failed', error: '格式错误（需要邮箱或11位手机号）' })
          failedCount++
          continue
        }

        // 检查用户是否已存在
        const existingUser = await db
          .selectFrom('users')
          .select(['id', 'account'])
          .$if(isEmail, (qb) => qb.where('email', '=', identifier))
          .$if(isPhone, (qb) => qb.where('phone', '=', identifier))
          .executeTakeFirst()

        if (existingUser) {
          const isMember = await db
            .selectFrom('team_members')
            .select('user_id')
            .where('team_id', '=', teamId)
            .where('user_id', '=', existingUser.id)
            .executeTakeFirst()

          if (isMember) {
            results.push({ identifier, status: 'exists', user_id: existingUser.id, error: '已是团队成员' })
            existsCount++
            continue
          }
        }

        const baseUsername = isEmail ? identifier.split('@')[0] : identifier.slice(-4)
        const username = await generateUsername(baseUsername)

        let userId: string
        if (!existingUser) {
          const newUser = await db
            .insertInto('users')
            .values({
              account: identifier,
              email: isEmail ? identifier : null,
              phone: isPhone ? identifier : null,
              username,
              password_hash: passwordHash,
              role: 'member',
              status: 'active',
              plan_tier: 'free',
              password_change_required: true,
            })
            .returning('id')
            .executeTakeFirstOrThrow()
          userId = newUser.id
        } else {
          userId = existingUser.id
        }

        // 加入团队
        await db
          .insertInto('team_members')
          .values({
            team_id: teamId,
            user_id: userId,
            role,
            credit_quota,
          })
          .execute()

        // 创建个人工作区
        const workspaceName = `${username}工作区`
        const workspace = await db
          .insertInto('workspaces')
          .values({
            team_id: teamId,
            name: workspaceName,
            created_by: request.user.id,
          })
          .returning('id')
          .executeTakeFirstOrThrow()

        const wsRole = role === 'viewer' ? 'viewer' : 'editor'
        await db
          .insertInto('workspace_members')
          .values({
            workspace_id: workspace.id,
            user_id: userId,
            role: wsRole,
          })
          .execute()

        // 将 owner 也加入工作区
        await db
          .insertInto('workspace_members')
          .values({
            workspace_id: workspace.id,
            user_id: request.user.id,
            role: 'admin',
          })
          .execute()

        results.push({
          identifier,
          status: 'success',
          user_id: userId,
          workspace_id: workspace.id,
          workspace_name: workspaceName,
          username,
        })
        successCount++
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        app.log.error({ identifier, err: errMsg }, 'Batch user creation failed for identifier')
        results.push({ identifier, status: 'failed', error: errMsg.slice(0, 200) })
        failedCount++
      }
    }

    return reply.status(200).send({
      success: successCount,
      failed: failedCount,
      exists: existsCount,
      results,
    })
  })
}

export default route
