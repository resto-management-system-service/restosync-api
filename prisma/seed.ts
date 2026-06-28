import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = 'admin@restosync.local';
  const passwordHash = await bcrypt.hash('Admin123!', 10);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash,
      firstName: 'Resto',
      lastName: 'Admin',
      role: Role.ADMIN,
    },
  });

  const categoryId = '11111111-1111-4111-8111-111111111111';
  const category = await prisma.category.upsert({
    where: { id: categoryId },
    update: {},
    create: {
      id: categoryId,
      name: 'Burgers',
      sortOrder: 1,
    },
  });

  await prisma.menuItem.upsert({
    where: { id: '22222222-2222-4222-8222-222222222222' },
    update: {},
    create: {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Classic Cheeseburger',
      description: 'Beef patty, cheddar, lettuce, tomato',
      priceCents: 1200,
      categoryId: category.id,
    },
  });

  console.log(`Seeded admin user: ${admin.email} (password: Admin123!)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
