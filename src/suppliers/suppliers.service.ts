import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateSupplierDto) {
    const existing = await this.prisma.supplier.findUnique({
      where: { userId_email: { userId, email: dto.email } },
    });

    if (existing) {
      throw new ConflictException('Fornecedor com este email ja existe');
    }

    return this.prisma.supplier.create({
      data: {
        userId,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        contactName: dto.contactName,
        street: dto.street,
        city: dto.city,
        state: dto.state,
        zipCode: dto.zipCode,
        country: dto.country || 'US',
        tags: dto.tags || [],
        notes: dto.notes,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async findAll(
    options?: {
      search?: string;
      tags?: string;
      isActive?: string;
    },
  ) {
    const where: Prisma.SupplierWhereInput = {};

    if (options?.isActive !== undefined && options.isActive !== '') {
      where.isActive = options.isActive === 'true';
    }

    if (options?.search) {
      where.OR = [
        { name: { contains: options.search } },
        { email: { contains: options.search } },
        { contactName: { contains: options.search } },
      ];
    }

    const suppliers = await this.prisma.supplier.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    // Filter by tags in application layer (JSON field)
    if (options?.tags) {
      const filterTags = options.tags.split(',').map((t) => t.trim().toLowerCase());
      return suppliers.filter((s) => {
        const supplierTags = (s.tags as string[]) || [];
        return filterTags.some((ft) =>
          supplierTags.some((st) => st.toLowerCase().includes(ft)),
        );
      });
    }

    return suppliers;
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id },
    });

    if (!supplier) {
      throw new NotFoundException('Fornecedor nao encontrado');
    }

    return supplier;
  }

  async update(id: string, dto: UpdateSupplierDto) {
    await this.findOne(id);

    if (dto.email) {
      const existing = await this.prisma.supplier.findFirst({
        where: {
          email: dto.email,
          NOT: { id },
        },
      });

      if (existing) {
        throw new ConflictException('Outro fornecedor com este email ja existe');
      }
    }

    return this.prisma.supplier.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.contactName !== undefined && { contactName: dto.contactName }),
        ...(dto.street !== undefined && { street: dto.street }),
        ...(dto.city !== undefined && { city: dto.city }),
        ...(dto.state !== undefined && { state: dto.state }),
        ...(dto.zipCode !== undefined && { zipCode: dto.zipCode }),
        ...(dto.country !== undefined && { country: dto.country }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.supplier.delete({ where: { id } });
  }
}
