import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { MenuItemsController } from './menu-items.controller';
import { MenuItemsService } from './menu-items.service';

@Module({
  controllers: [CategoriesController, MenuItemsController],
  providers: [CategoriesService, MenuItemsService],
  exports: [MenuItemsService],
})
export class MenuModule {}
