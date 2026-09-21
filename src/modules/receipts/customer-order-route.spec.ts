import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, expect, it, vi } from 'vitest';
import { CUSTOMER_SESSION_COOKIE } from '../../common/http.util';
import { PrismaService } from '../prisma/prisma.service';
import { PublicReceiptMediaController, PublicReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';

let app: INestApplication | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

it('serves the receipt order link at the customer-authenticated route', async () => {
  const createCustomerOrderLink = vi.fn().mockResolvedValue({ token: 'new-private-link' });
  const moduleRef = await Test.createTestingModule({
    controllers: [PublicReceiptsController, PublicReceiptMediaController],
    providers: [
      { provide: ReceiptsService, useValue: { createCustomerOrderLink } },
      { provide: PrismaService, useValue: { customerAccountSession: { findUnique: vi.fn().mockResolvedValue({ id: 'session', customerAccountId: 'account', revokedAt: null, expiresAt: new Date(Date.now() + 60000) }) } } },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
  await request(app.getHttpServer()).post('/api/v1/public/receipts/receipt-token/order-link').expect(401);
  expect(createCustomerOrderLink).not.toHaveBeenCalled();
  const response = await request(app.getHttpServer()).post('/api/v1/public/receipts/receipt-token/order-link').set('Cookie', `${CUSTOMER_SESSION_COOKIE}=fixture-session`).expect(201);
  expect(response.body.data).toEqual({ token: 'new-private-link' });
  expect(createCustomerOrderLink).toHaveBeenCalledWith('account', 'receipt-token');
  await request(app.getHttpServer()).post('/api/v1/public/receipt-media/receipt-token/order-link').expect(404);
});
