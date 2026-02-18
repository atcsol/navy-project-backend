import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GmailService } from './gmail.service';
import { GmailController } from './gmail.controller';
import { EncryptionService } from '../common/services/encryption.service';
import { QueuesModule } from '../queues/queues.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
      inject: [ConfigService],
    }),
    forwardRef(() => QueuesModule),
  ],
  controllers: [GmailController],
  providers: [GmailService, EncryptionService],
  exports: [GmailService],
})
export class GmailModule {}
