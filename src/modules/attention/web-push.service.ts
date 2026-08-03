import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
} from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";

type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

type StoredSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

@Injectable()
export class WebPushService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  configured() {
    return Boolean(
      this.config.get<string>("WEB_PUSH_VAPID_PUBLIC_KEY")
      && this.config.get<string>("WEB_PUSH_VAPID_PRIVATE_KEY")
      && this.config.get<string>("WEB_PUSH_SUBJECT"),
    );
  }

  async sendToOwner(businessId: string, userId: string, payload: PushPayload) {
    if (!this.configured()) {
      throw new ServiceUnavailableException("Web Push is not configured");
    }
    const subscriptions = await this.prisma.ownerPushSubscription.findMany({
      where: {
        businessId,
        userId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    const results = [];
    for (const subscription of subscriptions) {
      results.push(await this.send(subscription, payload));
    }
    return {
      attempted: results.length,
      sent: results.filter((result) => result === "SENT").length,
      removed: results.filter((result) => result === "REMOVED").length,
    };
  }

  private async send(subscription: StoredSubscription, payload: PushPayload) {
    const endpoint = new URL(subscription.endpoint);
    const encrypted = encryptPayload(
      Buffer.from(JSON.stringify(payload)),
      Buffer.from(subscription.p256dh, "base64url"),
      Buffer.from(subscription.auth, "base64url"),
    );
    const authorization = this.vapidAuthorization(endpoint.origin);
    let response: Response;
    try {
      response = await fetch(subscription.endpoint, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: "86400",
          Urgency: "normal",
        },
        body: encrypted,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return "FAILED" as const;
    }
    if (response.status === 404 || response.status === 410) {
      await this.prisma.ownerPushSubscription.deleteMany({ where: { id: subscription.id } });
      return "REMOVED" as const;
    }
    return response.ok ? "SENT" as const : "FAILED" as const;
  }

  private vapidAuthorization(audience: string) {
    const publicKey = Buffer.from(
      this.config.getOrThrow<string>("WEB_PUSH_VAPID_PUBLIC_KEY"),
      "base64url",
    );
    const privateKey = Buffer.from(
      this.config.getOrThrow<string>("WEB_PUSH_VAPID_PRIVATE_KEY"),
      "base64url",
    );
    if (publicKey.length !== 65 || publicKey[0] !== 4 || privateKey.length !== 32) {
      throw new ServiceUnavailableException("Web Push VAPID keys are invalid");
    }
    const header = base64urlJson({ alg: "ES256", typ: "JWT" });
    const claims = base64urlJson({
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
      sub: this.config.getOrThrow<string>("WEB_PUSH_SUBJECT"),
    });
    const unsigned = `${header}.${claims}`;
    const key = createPrivateKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        d: privateKey.toString("base64url"),
        x: publicKey.subarray(1, 33).toString("base64url"),
        y: publicKey.subarray(33, 65).toString("base64url"),
      },
    });
    const signature = sign("sha256", Buffer.from(unsigned), {
      key,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url");
    return `vapid t=${unsigned}.${signature}, k=${publicKey.toString("base64url")}`;
  }
}

function encryptPayload(payload: Buffer, clientPublicKey: Buffer, authSecret: Buffer) {
  if (clientPublicKey.length !== 65 || clientPublicKey[0] !== 4 || authSecret.length < 16) {
    throw new ServiceUnavailableException("Push subscription keys are invalid");
  }
  const sender = createECDH("prime256v1");
  sender.generateKeys();
  const senderPublicKey = sender.getPublicKey();
  const sharedSecret = sender.computeSecret(clientPublicKey);
  const authPrk = hkdfExtract(authSecret, sharedSecret);
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"),
    clientPublicKey,
    senderPublicKey,
  ]);
  const inputKeyMaterial = hkdfExpand(authPrk, keyInfo, 32);
  const salt = randomBytes(16);
  const prk = hkdfExtract(salt, inputKeyMaterial);
  const contentEncryptionKey = hkdfExpand(
    prk,
    Buffer.from("Content-Encoding: aes128gcm\0", "utf8"),
    16,
  );
  const nonce = hkdfExpand(
    prk,
    Buffer.from("Content-Encoding: nonce\0", "utf8"),
    12,
  );
  const plaintext = Buffer.concat([payload, Buffer.from([2])]);
  const cipher = createCipheriv("aes-128-gcm", contentEncryptionKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return Buffer.concat([
    salt,
    recordSize,
    Buffer.from([senderPublicKey.length]),
    senderPublicKey,
    ciphertext,
  ]);
}

function hkdfExtract(salt: Buffer, inputKeyMaterial: Buffer) {
  return createHmac("sha256", salt).update(inputKeyMaterial).digest();
}

function hkdfExpand(prk: Buffer, info: Buffer, length: number) {
  const output: Buffer[] = [];
  let previous = Buffer.alloc(0);
  let counter = 1;
  while (Buffer.concat(output).length < length) {
    previous = createHmac("sha256", prk)
      .update(Buffer.concat([previous, info, Buffer.from([counter])]))
      .digest();
    output.push(previous);
    counter += 1;
  }
  return Buffer.concat(output).subarray(0, length);
}

function base64urlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
