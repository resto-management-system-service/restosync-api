import { DocumentBuilder } from '@nestjs/swagger';

export const swaggerConfig = new DocumentBuilder()
  .setTitle('RestoSync API')
  .setDescription('Restaurant management API — menu, orders, payments')
  .setVersion('0.1.0')
  .addBearerAuth()
  .build();
