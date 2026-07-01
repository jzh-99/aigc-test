// client.ts
//
// Nacos 客户端工厂：把官方 nacos-sdk-nodejs 的 NacosConfigClient 封装成
// apply-config.ts 需要的 ConfigSource 接口（getConfig + subscribe）。
//
// 这样做的两个好处：
// 1. 业务/测试代码只依赖 ConfigSource 抽象，不直接 import 'nacos'，便于 mock。
// 2. 把 SDK 的鉴权参数（username/password）、namespace、连接细节收口在本文件，
//    上层只需传 serverAddr。
//
// 认证说明：Nacos 2.x 开启 NACOS_AUTH_ENABLE=true 后，客户端必须带 username/password。
// 这些值本身不能放进 Nacos（鸡生蛋），只能走容器 env。

import { NacosConfigClient } from 'nacos'
import type { ConfigSource } from './apply-config.js'

export interface NacosClientOptions {
  /** Nacos 服务端地址，格式 "host:port"（如 "10.0.0.5:8848"）。多个用逗号分隔。 */
  serverAddr: string
  /** 命名空间 ID（不是命名空间名）。dev/staging/production。默认 public。 */
  namespace?: string
  /** 开启鉴权后的账号。 */
  username?: string
  /** 开启鉴权后的密码。 */
  password?: string
  /** 连接就绪超时（毫秒）。超时会抛错并阻断启动。默认 5000。 */
  readyTimeoutMs?: number
  /** 配置轮询间隔（毫秒）。默认 30000；不用 SDK subscribe 长轮询，规避 Windows 原生崩溃。 */
  pollIntervalMs?: number
}

/**
 * 创建并就绪一个 Nacos 配置客户端，封装为 ConfigSource。
 *
 * 失败行为：若 ready 超时或连接失败，抛出错误。方案 B 下 Nacos 是 AI 配置强依赖，
 * 调用方（loadNacosConfig）会继续抛出并阻断启动。
 */
export async function createNacosConfigSource(opts: NacosClientOptions): Promise<ConfigSource> {
  const { namespace, username, password, readyTimeoutMs = 5_000, pollIntervalMs = 30_000 } = opts
  // ⚠️ Windows 踩坑：nacos-sdk-nodejs 内部的 urllib 对 "localhost" 做了 IPv6 优先解析（::1），
  // 而 SDK 的长轮询连接在 IPv6 上会持续报 EADDRINUSE（误导性错误，实际是连接异常），
  // 刷屏且偶发导致进程崩溃（Exit 3221226505）。统一把 localhost 归一化为 127.0.0.1，
  // 绕过 DNS 解析，让本地开发用 localhost 或 127.0.0.1 都能正常工作。
  // 生产环境填的是真实 IP/域名，不受影响。
  const serverAddr = normalizeServerAddr(opts.serverAddr)

  const client = new NacosConfigClient({
    serverAddr,
    namespace: namespace ?? 'public',
    // 仅在提供凭据时传入，避免 SDK 用 undefined 触发非预期鉴权流程
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  })

  // 等待连接就绪，加超时保护（SDK 自身的 ready 可能因网络问题长时间挂起）
  await withTimeout(client.ready(), readyTimeoutMs, `Nacos 连接就绪超时（${readyTimeoutMs}ms）`)

  return {
    getConfig(dataId: string, group: string): Promise<string> {
      return client.getConfig(dataId, group)
    },
    subscribe(info, listener) {
      // nacos-sdk-nodejs 的 subscribe 在 Windows 本地开发下与 Redis 定时命令并存时，
      // 偶发触发 Node 原生退出（Exit status 3221226505），且没有稳定的 JS 异常可捕获。
      // 这里不用 SDK 长轮询订阅，改为轻量轮询 getConfig：仍支持热更新，只是最多延迟
      // pollIntervalMs 生效；同时避免底层长轮询连接造成进程崩溃。
      let lastContent: string | null = null
      let polling = false
      const intervalMs = Number.isFinite(pollIntervalMs) && pollIntervalMs > 0 ? pollIntervalMs : 30_000
      const timer = setInterval(() => {
        if (polling) return
        polling = true
        client
          .getConfig(info.dataId, info.group)
          .then((content) => {
            if (lastContent === null) {
              lastContent = content
              return
            }
            if (content !== lastContent) {
              lastContent = content
              listener(content)
            }
          })
          .catch((err) => {
            console.warn(`[nacos-config] 轮询配置失败：${info.dataId}`, err)
          })
          .finally(() => {
            polling = false
          })
      }, intervalMs)
      timer.unref?.()
      return () => {
        clearInterval(timer)
      }
    },
  }
}

/** 带超时的 Promise 包装。超时则 reject，不取消底层 promise（连接仍在后台，
 * 但不再等待）。 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/**
 * 归一化 Nacos 服务端地址：把主机名里的 localhost 替换为 127.0.0.1。
 *
 * 仅替换作为主机名出现的 localhost（不替换域名子串如 localhost.example.com）。
 * 支持多地址逗号分隔（每段独立处理）。
 *
 * 用途：规避 nacos-sdk-nodejs 在 Windows 上对 localhost 的 IPv6 解析 bug
 * （见 createNacosConfigSource 的注释）。
 */
function normalizeServerAddr(serverAddr: string): string {
  if (!serverAddr) return serverAddr
  return serverAddr
    .split(',')
    .map((part) => part.trim())
    .map((part) => {
      // 匹配 localhost:host 或 [localhost]:host 形式，仅替换主机名部分
      return part.replace(/^(\[?)(localhost)(\]?:)/i, (_m, bracket, host, colon) => {
        return `${bracket}127.0.0.1${colon}`
      })
    })
    .join(',')
}
