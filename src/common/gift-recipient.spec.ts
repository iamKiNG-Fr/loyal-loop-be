import 'reflect-metadata';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { validateGiftRecipient } from './gift-recipient';
import { UpdateCartGroupDto } from '../modules/carts/dto/cart.dto';
import { CreateSaleDto } from '../modules/sales/dto/sale.dto';
import { CreateOrderRequestDto } from '../modules/shops/dto/shop.dto';

describe('gift recipient validation', () => {
  it.each([UpdateCartGroupDto, CreateSaleDto, CreateOrderRequestDto])('rejects arbitrary phone text at the request boundary: %s', async Dto => {
    for (const phone of ['test', '0803abc3333', '123456', '+1234567890123456']) {
      const errors = await validate(Object.assign(new Dto(), { recipientPhone: phone }));
      expect(errors.some(error => error.property === 'recipientPhone')).toBe(true);
    }
    const errors = await validate(Object.assign(new Dto(), { recipientPhone: '+234 (803) 333-4444' }));
    expect(errors.some(error => error.property === 'recipientPhone')).toBe(false);
  });

  it('allows clearing a cart phone and leaving optional occasion empty', async () => {
    expect(await validate(Object.assign(new UpdateCartGroupDto(), { recipientPhone: '', giftOccasion: '' }))).toEqual([]);
  });

  it('checks legacy saved drafts again at submission and requires a recipient name', () => {
    expect(() => validateGiftRecipient({ isGift: true, recipientName: 'Amina', recipientPhone: 'dfsfsd' })).toThrow('7–15 digits');
    expect(() => validateGiftRecipient({ isGift: true, recipientName: ' ', recipientPhone: '+2348033334444' })).toThrow(/recipient.*name/);
    expect(() => validateGiftRecipient({ isGift: false, recipientPhone: 'stale draft' })).not.toThrow();
    expect(() => validateGiftRecipient({ isGift: true, recipientName: 'Amina', recipientPhone: '+2348033334444' })).not.toThrow();
  });
});
