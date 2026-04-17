import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'

export async function POST(req: NextRequest) {
  const { secret, userId, account } = await req.json()

  if (!secret || !userId || !account) {
    return NextResponse.json({ error: '请填写所有字段' }, { status: 400 })
  }
  if (secret.length < 32) {
    return NextResponse.json({ error: 'JWT_SECRET 至少需要 32 个字符' }, { status: 400 })
  }

  const token = jwt.sign(
    { sub: userId, email: account, role: 'member' },
    secret,
    { expiresIn: '3m' },
  )

  return NextResponse.json({ token })
}
