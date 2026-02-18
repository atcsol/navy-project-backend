import { Module } from '@nestjs/common';
import { FingerprintingService } from './fingerprinting.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [FingerprintingService],
  exports: [FingerprintingService],
})
export class FingerprintingModule {}
