export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
  siteUrl: process.env.SITE_URL || 'http://localhost:5173',

  databaseUrl: process.env.DATABASE_URL || '',

  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  ed25519PrivateKey: process.env.ED25519_PRIVATE_KEY || '',
  ed25519PublicKey: process.env.ED25519_PUBLIC_KEY || '',

  alipayAppId: process.env.ALIPAY_APP_ID || '',
  alipayPrivateKey: process.env.ALIPAY_PRIVATE_KEY || '',
  alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY || '',
  alipayAesKey: process.env.ALIPAY_AES_KEY || '',
  alipayGateway: process.env.ALIPAY_GATEWAY || '',

  wechatAppId: process.env.WECHAT_APP_ID || '',
  wechatMchId: process.env.WECHAT_MCH_ID || '',
  wechatSerialNo: process.env.WECHAT_SERIAL_NO || '',
  wechatApiKey: process.env.WECHAT_API_KEY || '',
  wechatCertPath: process.env.WECHAT_CERT_PATH || '',
  wechatPrivateKeyPath: process.env.WECHAT_PRIVATE_KEY_PATH || '',

  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',

  defaultTrialDays: parseInt(process.env.DEFAULT_TRIAL_DAYS || '7', 10),
  licensePrice: parseFloat(process.env.LICENSE_PRICE || '99.00'),
  licenseDiscountPrice: process.env.LICENSE_DISCOUNT_PRICE ? parseFloat(process.env.LICENSE_DISCOUNT_PRICE) : null,

  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
}
