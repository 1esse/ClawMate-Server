import { FastifyInstance } from 'fastify'
import { markOrderPaid } from '../services/order'
import { verifyAlipaySignature, verifyWechatSignature, decryptWechatResource, decryptAlipayContent } from '../services/payment'
import { AppError } from '../utils/error'

export async function paymentRoutes(fastify: FastifyInstance) {
  fastify.post('/alipay-callback', async (request, reply) => {
    const params = request.body as Record<string, string>

    if (!verifyAlipaySignature(params)) {
      throw new AppError('Invalid signature', 400)
    }

    // AES 解密（如果启用了加密通信）
    if (params.encrypt_type === 'AES' && params.biz_content) {
      params.biz_content = decryptAlipayContent(params.biz_content)
    }

    const tradeStatus = params.trade_status
    if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
      return reply.type('text/plain').send('success')
    }

    const outTradeNo = params.out_trade_no
    if (!outTradeNo) {
      throw new AppError('Missing out_trade_no', 400)
    }

    await markOrderPaid(outTradeNo, 'alipay')

    return reply.type('text/plain').send('success')
  })

  fastify.post('/wechat-callback', async (request, reply) => {
    const body = request.body as {
      resource?: {
        ciphertext: string
        nonce: string
        associated_data: string
      }
      event_type?: string
    }

    const headers = request.headers as Record<string, string>
    const rawBody = JSON.stringify(request.body)

    if (!await verifyWechatSignature(headers, rawBody)) {
      throw new AppError('Invalid signature', 400)
    }

    if (body.event_type !== 'TRANSACTION.SUCCESS' || !body.resource) {
      return reply.send({ code: 'SUCCESS', message: 'OK' })
    }

    const decrypted = decryptWechatResource(body.resource)
    let data: { out_trade_no?: string } = {}

    try {
      data = JSON.parse(decrypted)
    } catch {
      throw new AppError('Failed to decrypt wechat resource', 400)
    }

    if (!data.out_trade_no) {
      throw new AppError('Missing out_trade_no', 400)
    }

    await markOrderPaid(data.out_trade_no, 'wechat')

    return reply.send({ code: 'SUCCESS', message: 'OK' })
  })
}
