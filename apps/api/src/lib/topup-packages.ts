// ─── 充值套餐配置 ──────────────────────────────────────────────────────────────
// 修改此文件即可更新套餐，无需改其他地方
// amount_fen: 价格（分）；credits: 赠送积分数；tag: 可选标签

export interface TopupPackageConfig {
  id: string
  name: string
  amount_fen: number
  credits: number
  tag?: string
}

export const TOPUP_PACKAGES: TopupPackageConfig[] = [
  { id: 'pkg_100',  name: '100 积分',  amount_fen: 1000,  credits: 100 },
  { id: 'pkg_500',  name: '500 积分',  amount_fen: 4500,  credits: 500,  tag: '推荐' },
  { id: 'pkg_1000', name: '1000 积分', amount_fen: 8000,  credits: 1000 },
  { id: 'pkg_5000', name: '5000 积分', amount_fen: 35000, credits: 5000, tag: '超值' },
]

export const TOPUP_PACKAGE_MAP = Object.fromEntries(TOPUP_PACKAGES.map((p) => [p.id, p]))
