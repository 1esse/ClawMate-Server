import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const defaultTrialDays = parseInt(process.env.DEFAULT_TRIAL_DAYS || '7', 10)
  await prisma.appConfig.upsert({
    where: { key: 'trial_days' },
    update: { value: defaultTrialDays },
    create: { key: 'trial_days', value: defaultTrialDays },
  })

  const licensePrice = parseFloat(process.env.LICENSE_PRICE || '99.00')
  await prisma.appConfig.upsert({
    where: { key: 'license_price' },
    update: { value: licensePrice },
    create: { key: 'license_price', value: licensePrice },
  })

  const licenseDiscountPrice = parseFloat(process.env.LICENSE_DISCOUNT_PRICE || '0')
  await prisma.appConfig.upsert({
    where: { key: 'license_discount_price' },
    update: { value: licenseDiscountPrice },
    create: { key: 'license_discount_price', value: licenseDiscountPrice },
  })

  const adminUsername = process.env.ADMIN_USERNAME || 'admin'
  const adminPassword = process.env.ADMIN_PASSWORD

  if (adminPassword) {
    const existing = await prisma.admin.findUnique({ where: { username: adminUsername } })
    if (!existing) {
      const passwordHash = await bcrypt.hash(adminPassword, 12)
      await prisma.admin.create({
        data: { username: adminUsername, passwordHash },
      })
      console.log(`Admin user "${adminUsername}" created`)
    } else {
      console.log(`Admin user "${adminUsername}" already exists, skipping`)
    }
  } else {
    console.log('No ADMIN_PASSWORD set, skipping admin creation')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
