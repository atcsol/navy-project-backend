import { Module } from '@nestjs/common';
import { ParsingService } from './parsing.service';

@Module({
  providers: [ParsingService],
  exports: [ParsingService],
})
export class ParsingModule {}
