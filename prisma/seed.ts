import { OrderStatus, OrderType, PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // All demo data belongs to a single default restaurant. Reuses the same
  // row the #149 backfill script creates if it already ran.
  const restaurant = await prisma.restaurant.upsert({
    where: { id: '00000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'El Buen Filo',
      timezone: 'America/Lima',
    },
  });

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
      restaurantId: restaurant.id,
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
      restaurantId: restaurant.id,
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
      restaurantId: restaurant.id,
    },
  });

  const cashierEmail = 'cashier@restosync.local';
  const cashierPasswordHash = await bcrypt.hash('Cashier123!', 10);
  const cashier = await prisma.user.upsert({
    where: { email: cashierEmail },
    update: {},
    create: {
      email: cashierEmail,
      passwordHash: cashierPasswordHash,
      firstName: 'Regina',
      lastName: 'Cashier',
      role: Role.CASHIER,
      restaurantId: restaurant.id,
    },
  });

  const waiterEmail = 'waiter@restosync.local';
  const waiterPasswordHash = await bcrypt.hash('Waiter123!', 10);
  const waiter = await prisma.user.upsert({
    where: { email: waiterEmail },
    update: {},
    create: {
      email: waiterEmail,
      passwordHash: waiterPasswordHash,
      firstName: 'Walter',
      lastName: 'Waiter',
      role: Role.WAITER,
      restaurantId: restaurant.id,
    },
  });

  const managerEmail = 'manager@restosync.local';
  const managerPasswordHash = await bcrypt.hash('Manager123!', 10);
  const manager = await prisma.user.upsert({
    where: { email: managerEmail },
    update: {},
    create: {
      email: managerEmail,
      passwordHash: managerPasswordHash,
      firstName: 'Manuel',
      lastName: 'Manager',
      role: Role.MANAGER,
      restaurantId: restaurant.id,
    },
  });

  console.log(`Seeded admin user: ${admin.email} (password: Admin123!)`);
  console.log(`Seeded cashier user: ${cashier.email} (password: Cashier123!)`);
  console.log(`Seeded waiter user: ${waiter.email} (password: Waiter123!)`);
  console.log(`Seeded manager user: ${manager.email} (password: Manager123!)`);

  // ─── Demo categories ──────────────────────────────────────────

  const categories = [
    { id: '33333333-3333-4333-8333-333333333301', name: 'Entradas', sortOrder: 2 },
    { id: '33333333-3333-4333-8333-333333333302', name: 'Platos de Fondo', sortOrder: 3 },
    { id: '33333333-3333-4333-8333-333333333303', name: 'Bebidas', sortOrder: 4 },
    { id: '33333333-3333-4333-8333-333333333304', name: 'Postres', sortOrder: 5 },
  ];

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { id: cat.id },
      update: { name: cat.name, sortOrder: cat.sortOrder },
      create: { ...cat, restaurantId: restaurant.id },
    });
  }

  // ─── Demo menu items ───────────────────────────────────────────

  const menuItems = [
    { id: '44444444-4444-4444-8444-444444444401', name: 'Ceviche Clásico', priceCents: 1800, categoryId: categories[0].id },
    { id: '44444444-4444-4444-8444-444444444402', name: 'Causa Limeña', priceCents: 1200, categoryId: categories[0].id },
    { id: '44444444-4444-4444-8444-444444444403', name: 'Tequeños', priceCents: 900, categoryId: categories[0].id },

    { id: '44444444-4444-4444-8444-444444444404', name: 'Lomo Saltado', priceCents: 2500, categoryId: categories[1].id },
    { id: '44444444-4444-4444-8444-444444444405', name: 'Ají de Gallina', priceCents: 2200, categoryId: categories[1].id },
    { id: '44444444-4444-4444-8444-444444444406', name: 'Arroz con Leche', priceCents: 1500, categoryId: categories[1].id },

    { id: '44444444-4444-4444-8444-444444444407', name: 'Chicha Morada', priceCents: 600, categoryId: categories[2].id },
    { id: '44444444-4444-4444-8444-444444444408', name: 'Inca Kola', priceCents: 400, categoryId: categories[2].id },
    { id: '44444444-4444-4444-8444-444444444409', name: 'Agua Mineral', priceCents: 300, categoryId: categories[2].id },

    { id: '44444444-4444-4444-8444-444444444410', name: 'Mazamorra Morada', priceCents: 800, categoryId: categories[3].id },
    { id: '44444444-4444-4444-8444-444444444411', name: 'Suspiro Limeño', priceCents: 900, categoryId: categories[3].id },
    { id: '44444444-4444-4444-8444-444444444412', name: 'Picarones', priceCents: 700, categoryId: categories[3].id },
  ];

  for (const item of menuItems) {
    await prisma.menuItem.upsert({
      where: { id: item.id },
      update: { name: item.name, priceCents: item.priceCents, categoryId: item.categoryId },
      create: { ...item, restaurantId: restaurant.id },
    });
  }

  // ─── Demo tables ───────────────────────────────────────────────

  const demoTable = await prisma.table.upsert({
    where: { id: '55555555-5555-4555-8555-555555555501' },
    update: { name: 'Mesa 1', capacity: 4 },
    create: {
      id: '55555555-5555-4555-8555-555555555501',
      name: 'Mesa 1',
      capacity: 4,
      restaurantId: restaurant.id,
    },
  });

  // ─── Demo orders ───────────────────────────────────────────────

  const menuLookup = new Map(menuItems.map((m) => [m.name, m]));

  const demoOrders = [
    {
      number: 'DEMO-001',
      type: OrderType.DINE_IN,
      status: OrderStatus.DRAFT,
      tableId: demoTable.id as string | null,
      items: [
        { name: 'Ceviche Clásico', quantity: 2 },
        { name: 'Chicha Morada', quantity: 1 },
      ],
    },
    {
      number: 'DEMO-002',
      type: OrderType.TAKEAWAY,
      status: OrderStatus.DRAFT,
      tableId: null as string | null,
      items: [
        { name: 'Lomo Saltado', quantity: 1 },
        { name: 'Inca Kola', quantity: 2 },
      ],
    },
  ];

  for (const demo of demoOrders) {
    const existing = await prisma.order.findUnique({ where: { number: demo.number } });

    if (existing) {
      await prisma.orderItem.deleteMany({ where: { orderId: existing.id } });
    }

    const order = await prisma.order.upsert({
      where: { number: demo.number },
      update: { type: demo.type, status: demo.status, tableId: demo.tableId },
      create: {
        number: demo.number,
        type: demo.type,
        status: demo.status,
        tableId: demo.tableId,
        customerId: admin.id,
        restaurantId: restaurant.id,
      },
    });

    const itemRows = demo.items.map((di) => {
      const menuItem = menuLookup.get(di.name)!;
      return {
        orderId: order.id,
        menuItemId: menuItem.id,
        nameSnapshot: menuItem.name,
        priceCents: menuItem.priceCents,
        quantity: di.quantity,
        lineTotalCents: menuItem.priceCents * di.quantity,
        restaurantId: restaurant.id,
      };
    });

    await prisma.orderItem.createMany({ data: itemRows });

    const subtotalCents = itemRows.reduce((sum, i) => sum + i.lineTotalCents, 0);
    const taxCents = 0;
    const totalCents = subtotalCents + taxCents;

    await prisma.order.update({
      where: { id: order.id },
      data: { subtotalCents, taxCents, totalCents },
    });

    console.log(`Seeded order: ${order.number} (${order.type}, ${order.status}) — total: ${totalCents} cents`);
  }

  console.log('Demo seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
