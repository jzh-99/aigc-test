// ─── 充值套餐配置 ──────────────────────────────────────────────────────────────
// 修改此文件即可更新套餐，无需改其他地方

export interface TopupPackageConfig {
  id: string
  name: string
  amount_fen: number   // 价格（分）
  credits: number      // 赠送积分
  type: 'onetime' | 'monthly'
  tag?: string
}

// 单次购买套餐
export const ONETIME_PACKAGES: TopupPackageConfig[] = [
  { id: 'ot_500',  name: '500 积分',   amount_fen:  5000, credits:   500, type: 'onetime' },
  { id: 'ot_800',  name: '800 积分',   amount_fen:  7500, credits:   800, type: 'onetime', tag: '推荐' },
  { id: 'ot_1700', name: '1700 积分',  amount_fen: 15000, credits:  1700, type: 'onetime' },
  { id: 'ot_2600', name: '2600 积分',  amount_fen: 22500, credits:  2600, type: 'onetime' },
  { id: 'ot_5200', name: '5200 积分',  amount_fen: 45900, credits:  5200, type: 'onetime' },
  { id: 'ot_10500',name: '10500 积分', amount_fen: 89900, credits: 10500, type: 'onetime', tag: '超值' },
]

// 包月套餐
export const MONTHLY_PACKAGES: TopupPackageConfig[] = [
  { id: 'mo_750',   name: '750 积分/月',   amount_fen:  6000, credits:   750, type: 'monthly' },
  { id: 'mo_5200',  name: '5200 积分/月',  amount_fen: 39900, credits:  5200, type: 'monthly', tag: '推荐' },
  { id: 'mo_12000', name: '12000 积分/月', amount_fen: 89900, credits: 12000, type: 'monthly', tag: '超值' },
]

export const TOPUP_PACKAGES = [...ONETIME_PACKAGES, ...MONTHLY_PACKAGES]

export const TOPUP_PACKAGE_MAP = Object.fromEntries(TOPUP_PACKAGES.map((p) => [p.id, p]))
