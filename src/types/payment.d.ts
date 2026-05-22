declare module 'alipay-sdk' {
  class AlipaySdk {
    constructor(options: { appId: string; privateKey: string; alipayPublicKey: string })
    exec(method: string, params: Record<string, unknown>): Promise<Record<string, string>>
  }
  export default AlipaySdk
}

declare module 'wechatpay-node-v3' {
  class WxPay {
    constructor(options: { appid: string; mchid: string; publicKey: Buffer; privateKey: Buffer })
    transactions_native(params: Record<string, unknown>): Promise<Record<string, string>>
  }
  export default WxPay
}
