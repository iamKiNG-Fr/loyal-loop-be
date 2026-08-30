import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';

export type MonitoringEvent = {
  durationMs: number;
  method: string;
  path: string;
  requestId: string;
  severity: 'error' | 'warning';
  statusCode: number;
  timestamp: string;
  type: 'http_error' | 'slow_request';
};

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(private readonly config: ConfigService) {}

  async capture(event: MonitoringEvent) {
    const webhookUrl = this.config.get<string>('MONITORING_WEBHOOK_URL')?.trim();
    if (!webhookUrl) return;

    const payload = JSON.stringify(event);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const secret = this.config.get<string>('MONITORING_WEBHOOK_SECRET')?.trim();
    if (secret) {
      headers['x-loyal-loop-signature'] = createHmac('sha256', secret).update(payload).digest('hex');
    }

    try {
      const response = await fetch(webhookUrl, {
        body: payload,
        headers,
        method: 'POST',
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) this.logger.warn(`Monitoring webhook returned ${response.status}`);
    } catch (error) {
      this.logger.warn(`Monitoring webhook failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
}
