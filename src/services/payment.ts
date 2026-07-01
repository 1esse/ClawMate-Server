import crypto from 'crypto'
import fs from 'fs'
import { AlipaySdk } from 'alipay-sdk'
import WxPay from 'wechatpay-node-v3'
import { config } from '../config'

export interface PaymentResult {
  paymentUrl: string
  qrCode: string
}

function isProduction(): boolean {
  return config.nodeEnv === 'production'
}

function getAlipaySdk(): AlipaySdk {
  return new AlipaySdk({
    appId: config.alipayAppId,
    privateKey: config.alipayPrivateKey,
    alipayPublicKey: config.alipayPublicKey,
    gateway: config.alipayGateway || undefined,
    encryptKey: config.alipayAesKey || undefined,
  })
}

function getWxPay(): WxPay {
  return new WxPay({
    appid: config.wechatAppId,
    mchid: config.wechatMchId,
    serial_no: config.wechatSerialNo,
    publicKey: fs.readFileSync(config.wechatCertPath),
    privateKey: fs.readFileSync(config.wechatPrivateKeyPath),
    key: config.wechatApiKey,
  })
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
      qrCode: '',
    }
  }

  const alipaySdk = getAlipaySdk()

  const paymentUrl = alipaySdk.pageExec('alipay.trade.page.pay', {
    method: 'GET',
    returnUrl: `${config.siteUrl}/payment/callback`,
    notifyUrl: `${config.serverUrl}/api/v1/payment/alipay-callback`,
    bizContent: {
      out_trade_no: orderNo,
      total_amount: amount.toFixed(2),
      subject: 'ClawMate 许可证',
      product_code: 'FAST_INSTANT_TRADE_PAY',
      timeout_express: '30m',
    },
  })

  return {
    paymentUrl,
    qrCode: '',
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

  const pay = getWxPay()

  const result = await pay.transactions_native({
    description: 'ClawMate 许可证',
    out_trade_no: orderNo,
    notify_url: `${config.serverUrl}/api/v1/payment/wechat-callback`,
    amount: {
      total: parseInt(amount.toFixed(2).replace('.', ''), 10),
      currency: 'CNY',
    },
  }) as unknown as { status: number; data?: { code_url?: string }; error?: string }

  console.log('[WeChat] transactions_native result:', JSON.stringify(result))

  // 订单已支付（回调验签失败导致数据库未更新），主动查询并补偿
  if (result.status === 400 && result.error && result.error.includes('ORDERPAID')) {
    console.log('[WeChat] Order already paid, querying transaction status...')
    const queryResult = await pay.query({ out_trade_no: orderNo }) as unknown as { data?: { trade_state?: string; out_trade_no?: string } }
    console.log('[WeChat] query result:', JSON.stringify(queryResult))
    if (queryResult.data?.trade_state === 'SUCCESS') {
      // 返回特殊标记，由 order.ts 处理
      return { paymentUrl: '__ALREADY_PAID__', qrCode: '' }
    }
  }

  const codeUrl = result.data?.code_url
  if (!codeUrl) {
    console.error('[WeChat] No code_url in result:', JSON.stringify(result))
    throw new Error(`WeChat Pay order failed: ${JSON.stringify(result)}`)
  }

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
    const alipaySdk = getAlipaySdk()
    return alipaySdk.checkNotifySign(params, true)
  } catch (err) {
    console.error('[Alipay] Signature verification failed:', err)
    return false
  }
}

export function decryptAlipayContent(encrypted: string): string {
  const alipaySdk = getAlipaySdk()
  return alipaySdk.aesDecrypt(encrypted)
}

export async function verifyWechatSignature(headers: Record<string, string>, body: string): Promise<boolean> {
  if (!config.wechatApiKey) {
    if (isProduction()) {
      console.error('[WeChat] Rejecting callback: WECHAT_API_KEY not configured')
      return false
    }
    return true
  }

  try {
    // 用微信支付公钥直接验签，绕过 SDK 拉取平台证书
    const publicKey = fs.readFileSync(config.wechatCertPath, 'utf-8')
    const timestamp = headers['wechatpay-timestamp'] || ''
    const nonce = headers['wechatpay-nonce'] || ''
    const signature = headers['wechatpay-signature'] || ''

    const data = `${timestamp}\n${nonce}\n${body}\n`
    const verify = crypto.createVerify('RSA-SHA256')
    verify.update(data)
    verify.end()

    const result = verify.verify(publicKey, signature, 'base64')
    console.log('[WeChat] verifySign result:', result)
    return result
  } catch (err) {
    console.error('[WeChat] Signature verification failed:', err)
    return false
  }
}

export function decryptWechatResource(resource: { ciphertext: string; nonce: string; associated_data: string }): string | Record<string, unknown> {
  if (!config.wechatApiKey) {
    if (isProduction()) {
      throw new Error('WeChat API key not configured, cannot decrypt callback resource')
    }
    return resource.ciphertext
  }

  try {
    const pay = getWxPay()
    return pay.decipher_gcm(resource.ciphertext, resource.associated_data, resource.nonce)
  } catch (err) {
    console.error('[WeChat] Resource decryption failed:', err)
    throw new Error('Failed to decrypt WeChat callback resource')
  }
}
