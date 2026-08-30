import { Controller, Headers, Post } from '@nestjs/common';
import { ok } from '../../common/api-response';
import { RetentionService } from './retention.service';

@Controller('retention/internal')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Post('run')
  run(@Headers('x-retention-scheduler-secret') secret: string | undefined) {
    this.retention.assertSecret(secret);
    return this.retention.run().then((data) => ok(data, 'Retention schedule processed'));
  }
}
