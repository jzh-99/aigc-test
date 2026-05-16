import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'

/**
 * 签发访问令牌（Access Token）
 * @param user 用户基本信息
 * @returns JWT 字符串
 */
export function signAccessToken(user: { id: string; account: string; role: string }): string {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not set')
  const expiresIn = (process.env.JWT_ACCESS_EXPIRES_IN ?? '15m') as jwt.SignOptions['expiresIn']
  return jwt.sign({ sub: user.id, email: user.account, role: user.role }, secret, { expiresIn })
}

/**
 * 生成刷新令牌（Refresh Token）
 * @returns 32 字节随机十六进制字符串
 */
export function signRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex')
}
