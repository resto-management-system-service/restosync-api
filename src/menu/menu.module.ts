import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { MenuItemsController } from './menu-items.controller';
import { MenuItemsService } from './menu-items.service';
import { ModifiersController } from './modifiers.controller';
import { ModifiersService } from './modifiers.service';

@Module({
  controllers: [CategoriesController, MenuItemsController, ModifiersController],
  providers: [CategoriesService, MenuItemsService, ModifiersService],
  exports: [MenuItemsService, ModifiersService],
})
export class MenuModule {}
