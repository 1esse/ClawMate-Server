import { config } from '../config'

export interface PaymentResult {
  paymentUrl: string
  qrCode: string
}

function isProduction(): boolean {
  return config.nodeEnv === 'production'
}

export async function createPaymentOrder(
  orderNo: string,
  amount: number,
  paymentMethod: string
): Promise<PaymentResult> {
  if (paymentMethod === 'alipay') {
    return createAlipayOrder(orderNo, amount)
  }

  if (paymentMethod === 'wechat') {
    return createWechatOrder(orderNo, amount)
  }

  throw new Error(`Unsupported payment method: ${paymentMethod}`)
}

async function createAlipayOrder(orderNo: string, amount: number): Promise<PaymentResult> {
  if (!config.alipayAppId || !config.alipayPrivateKey) {
    if (isProduction()) {
      throw new Error('Alipay not configured')
    }
    return {
      paymentUrl: `https://openapi.alipay.com/mock/pay?orderNo=${orderNo}&amount=${amount}`,
      qrCode: `https://qr.alipay.com/mock/${orderNo}`,
    }
  }

  const AlipaySdk = (await import('alipay-sdk')).default
  const alipaySdk = new AlipaySdk({
    appId: config.alipayAppId,
    privateKey: config.alipayPrivateKey,
    alipayPublicKey: config.alipayPublicKey,
  })

  const result = await alipaySdk.exec('alipay.trade.precreate', {
    notifyUrl: `${config.serverUrl}/api/v1/payment/alipay-callback`,
    bizContent: {
      out_trade_no: orderNo,
      total_amount: amount.toFixed(2),
      subject: 'ClawMate 许可证',
      timeout_express: '30m',
    },
  })

  const qrCode = (result as Record<string, string>).qrCode || (result as Record<string, string>).qr_code || ''
  return {
    paymentUrl: qrCode,
    qrCode,
  }
}

async function createWechatOrder(orderNo: string, amount: number): Promise<PaymentResult> {
  if (!config.wechatMchId || !config.wechatPrivateKeyPath) {
    if (isProduction()) {
      throw new Error('WeChat Pay not configured')
    }
    return {
      paymentUrl: `weixin://wxpay/mock?orderNo=${orderNo}&amount=${amount}`,
      qrCode: `weixin://wxpay/mock/${orderNo}`,
    }
  }

  const fs = await import('fs')
  const WxPay = (await import('wechatpay-node-v3')).default
  const pay = new WxPay({
    appid: config.wechatAppId,
    mchid: config.wechatMchId,
    publicKey: fs.readFileSync(config.wechatCertPath),
    privateKey: fs.readFileSync(config.wechatPrivateKeyPath),
  })

  const result = await pay.transactions_native({
    description: 'ClawMate 许可证',
    out_trade_no: orderNo,
    notify_url: `${config.serverUrl}/api/v1/payment/wechat-callback`,
    amount: {
      total: parseInt(amount.toFixed(2).replace('.', ''), 10),
      currency: 'CNY',
    },
  })

  const codeUrl = (result as Record<string, string>).code_url || ''
  return {
    paymentUrl: codeUrl,
    qrCode: codeUrl,
  }
}

export function verifyAlipaySignature(params: Record<string, string>): boolean {
  if (!config.alipayPublicKey) {
    if (isProduction()) {
      console.error('[Alipay] Rejecting callback: ALIPAY_PUBLIC_KEY not configured')
      return false
    }
    return true
  }

  try {
    const crypto = require('crypto')
    const sign = params.sign
    const signType = params.sign_type
    const sortedKeys = Object.keys(params)
      .filter(k => k !== 'sign' && k !== 'sign_type' && params[k] !== '')
      .sort()
    const signStr = sortedKeys.map(k => `${k}=${params[k]}`).join('&')
    const verify = crypto.createVerify(signType === 'RSA2' ? 'RSA-SHA256' : 'RSA-SHA1')
    verify.update(signStr, 'utf8')
    return verify.verify(config.alipayPublicKey, sign, 'base64')
  } catch (err) {
    console.error('[Alipay] Signature verification failed:', err)
    return false
  }
}

export function verifyWechatSignature(headers: Record<string, string>, body: string): boolean {
  if (!config.wechatApiKey) {
    if (isProduction()) {
      console.error('[WeChat] Rejecting callback: WECHAT_API_KEY not configured')
      return false
    }
    return true
  }

  try {
    const crypto = require('crypto')
    const fs = require('fs')
    const timestamp = headers['wechatpay-timestamp'] || ''
    const nonce = headers['wechatpay-nonce'] || ''
    const signature = headers['wechatpay-signature'] || ''
    const message = `${timestamp}\n${nonce}\n${body}\n`
    const publicKey = fs.readFileSync(config.wechatCertPath, 'utf8')
    const verify = crypto.createVerify('RSA-SHA256')
    verify.update(message)
    return verify.verify(publicKey, signature, 'base64')
  } catch (err) {
    console.error('[WeChat] Signature verification failed:', err)
    return false
  }
}

export function decryptWechatResource(resource: { ciphertext: string; nonce: string; associated_data: string }): string {
  if (!config.wechatApiKey) {
    if (isProduction()) {
      throw new Error('WeChat API key not configured, cannot decrypt callback resource')
    }
    return resource.ciphertext
  }

  try {
    const crypto = require('crypto')
    const key = Buffer.from(config.wechatApiKey, 'utf8')
    const iv = Buffer.from(resource.nonce, 'utf8')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(Buffer.from(resource.ciphertext.slice(-16), 'base64'))
    decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'))
    const decrypted = decipher.update(resource.ciphertext.slice(0, -16), 'base64', 'utf8')
    return decrypted
  } catch (err) {
    console.error('[WeChat] Resource decryption failed:', err)
    throw new Error('Failed to decrypt WeChat callback resource')
  }
}
