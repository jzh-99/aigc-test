import type { FastifyPluginAsync } from 'fastify'
import { ONETIME_PACKAGES, MONTHLY_PACKAGES } from '../../lib/topup-packages.js'

const route: FastifyPluginAsync = async (app) => {
  // GET /payment/packages — 获取充值套餐列表
  app.get('/payment/packages', async () => ({
    onetime: ONETIME_PACKAGES,
    monthly: MONTHLY_PACKAGES,
  }))
}

export default route
