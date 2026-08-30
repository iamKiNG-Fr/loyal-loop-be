import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { RetentionController } from './retention.controller';
import { RetentionService } from './retention.service';

@Module({
  imports: [MediaModule],
  controllers: [RetentionController],
  providers: [RetentionService],
})
export class RetentionModule {}
