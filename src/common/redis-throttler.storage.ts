import type { ThrottlerStorage } from "@nestjs/throttler";
import { createClient, type RedisClientType } from "redis";

const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
local blocked = redis.call('EXISTS', KEYS[2])
if blocked == 0 and count > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blocked = 1
end
local blockTtl = redis.call('PTTL', KEYS[2])
return {count, ttl, blocked, blockTtl}
`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  private constructor(private readonly client: RedisClientType) {}

  static async connect(url: string) {
    const client = createClient({ url });
    await client.connect();
    return new RedisThrottlerStorage(client as RedisClientType);
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<{
    totalHits: number;
    timeToExpire: number;
    isBlocked: boolean;
    timeToBlockExpire: number;
  }> {
    const namespaced = `ll:throttle:${throttlerName}:${key}`;
    const result = await this.client.eval(INCREMENT_SCRIPT, {
      keys: [namespaced, `${namespaced}:blocked`],
      arguments: [String(ttl), String(limit), String(blockDuration || ttl)],
    }) as number[];
    const [totalHits = 0, ttlMs = 0, blocked = 0, blockTtlMs = 0] = result;
    return {
      totalHits,
      timeToExpire: Math.max(Math.ceil(ttlMs / 1000), 0),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.max(Math.ceil(blockTtlMs / 1000), 0),
    };
  }
}
