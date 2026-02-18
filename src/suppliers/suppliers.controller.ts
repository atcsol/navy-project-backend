import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserEntity } from '../users/entities/user.entity';

@Controller('suppliers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  @RequirePermission('suppliers.create')
  create(
    @CurrentUser() user: UserEntity,
    @Body() dto: CreateSupplierDto,
  ) {
    return this.suppliersService.create(user.id, dto);
  }

  @Get()
  @RequirePermission('suppliers.view')
  findAll(
    @CurrentUser() user: UserEntity,
    @Query('search') search?: string,
    @Query('tags') tags?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.suppliersService.findAll(user.id, { search, tags, isActive });
  }

  @Get(':id')
  @RequirePermission('suppliers.view')
  findOne(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.suppliersService.findOne(id, user.id);
  }

  @Patch(':id')
  @RequirePermission('suppliers.update')
  update(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliersService.update(id, user.id, dto);
  }

  @Delete(':id')
  @RequirePermission('suppliers.delete')
  remove(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.suppliersService.remove(id, user.id);
  }
}
