import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  ActivityEventType,
  PrismaClient,
} from "../src/generated/prisma/client";
import { hashToken } from "../src/common/crypto.util";
import { hashPassword } from "../src/common/password.util";

const DEMO_EMAIL = "demo@useloyalloop.com";
const DEMO_PASSWORD = "LoyalLoopDemo123!";
const DEMO_SLUG = "kings-store-demo";
const DEMO_CARD_ID = "LL-KINGDEMO";

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: required("DATABASE_URL"),
  }),
});

async function main() {
  const existingBusiness = await prisma.business.findUnique({
    where: { slug: DEMO_SLUG },
    include: {
      _count: {
        select: {
          customers: true,
          products: true,
          sales: true,
          orderRequests: true,
        },
      },
    },
  });

  if (existingBusiness) {
    await prisma.business.update({
      where: { id: existingBusiness.id },
      data: { publicCardId: DEMO_CARD_ID },
    });
    await prisma.businessPreferences.upsert({
      where: { businessId: existingBusiness.id },
      update: {
        tickerItems: [
          "New arrivals every week",
          "Receipts and delivery updates saved",
          "Ask about restocks on WhatsApp",
          "Repeat customers get remembered",
        ],
      },
      create: {
        businessId: existingBusiness.id,
        currency: "NGN",
        timezone: "Africa/Lagos",
        theme: "LOYAL_PURPLE",
        receiptFooter: "Thank you for shopping with King's Store.",
        tickerItems: [
          "New arrivals every week",
          "Receipts and delivery updates saved",
          "Ask about restocks on WhatsApp",
          "Repeat customers get remembered",
        ],
      },
    });

    printSeedInfo({
      action: "already-seeded",
      counts: existingBusiness._count,
    });
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {
      name: "Francis King",
      phone: "+2348012345678",
      passwordHash,
    },
    create: {
      name: "Francis King",
      email: DEMO_EMAIL,
      phone: "+2348012345678",
      passwordHash,
    },
  });

  const business = await prisma.business.create({
    data: {
      ownerId: user.id,
      name: "King's Store Demo",
      slug: DEMO_SLUG,
      publicCardId: DEMO_CARD_ID,
      category: "Fashion, fragrance & accessories",
      description:
        "A seeded Loyal Loop workspace for testing customer memory, receipts, and delivery.",
      location: "Lagos, Nigeria",
      pledgeSignature: "Francis King",
      pledgedAt: daysAgo(30),
      preferences: {
        create: {
          currency: "NGN",
          timezone: "Africa/Lagos",
          theme: "LOYAL_PURPLE",
          receiptFooter: "Thank you for shopping with King's Store.",
          tickerItems: [
            "New arrivals every week",
            "Receipts and delivery updates saved",
            "Ask about restocks on WhatsApp",
            "Repeat customers get remembered",
          ],
        },
      },
      contacts: {
        create: [
          {
            platform: "WHATSAPP",
            value: "+2348012345678",
            isPrimary: true,
            sortOrder: 0,
          },
          {
            platform: "INSTAGRAM",
            value: "@kingsstoredemo",
            sortOrder: 1,
          },
        ],
      },
      members: {
        create: {
          userId: user.id,
          role: "OWNER",
          status: "ACTIVE",
          joinedAt: daysAgo(30),
        },
      },
    },
  });

  const tags = await Promise.all(
    [
      ["Repeat customer", "Customers who have purchased more than once", "#6D36C8"],
      ["Perfume buyer", "Interested in fragrances and scent restocks", "#A43A61"],
      ["Sneaker buyer", "Interested in footwear drops", "#245F46"],
      ["Referral", "Introduced through an existing customer", "#315B8A"],
    ].map(([name, description, color]) =>
      prisma.customerTag.create({
        data: { businessId: business.id, name, description, color },
      }),
    ),
  );
  const tag = Object.fromEntries(tags.map((entry) => [entry.name, entry.id]));

  const customers = await Promise.all([
    createCustomer(business.id, user.id, {
      name: "Amaka Okafor",
      phone: "+2348012234401",
      channel: "WHATSAPP",
      note: "Prefers evening delivery and warm, vanilla-forward fragrances.",
      tagIds: [tag["Repeat customer"], tag["Perfume buyer"]],
      lastPurchasedAt: daysAgo(1),
    }),
    createCustomer(business.id, user.id, {
      name: "Nneka Eze",
      phone: "+2348038821094",
      channel: "INSTAGRAM",
      note: "Usually wears EU 39 and asks about red or neutral sneakers.",
      tagIds: [tag["Sneaker buyer"]],
      lastPurchasedAt: daysAgo(2),
    }),
    createCustomer(business.id, user.id, {
      name: "Chidi Paul",
      phone: "+2347062144480",
      channel: "REFERRAL",
      note: "Bought an accessory bundle after Tola referred him.",
      tagIds: [tag.Referral],
      lastPurchasedAt: daysAgo(2),
    }),
    createCustomer(business.id, user.id, {
      name: "Aisha Bello",
      phone: "+2348091002233",
      channel: "WHATSAPP",
      note: "Likes simple cotton basics and quick pickup.",
      tagIds: [tag["Repeat customer"]],
      lastPurchasedAt: daysAgo(6),
    }),
    createCustomer(business.id, user.id, {
      name: "Tunde Adeyemi",
      phone: "+2348025517744",
      channel: "WALK_IN",
      note: "Walk-in customer who often asks about phone accessories.",
      tagIds: [],
    }),
  ]);
  const customer = Object.fromEntries(
    customers.map((entry) => [entry.name, entry]),
  );

  const products = await Promise.all([
    createProduct(business.id, {
      name: "Black Opium perfume",
      slug: "black-opium-perfume",
      category: "Fragrance",
      description: "Warm coffee and vanilla fragrance.",
      price: "42000",
      stockCount: 12,
      placement: "TRENDING",
    }),
    createProduct(business.id, {
      name: "Red runner sneakers",
      slug: "red-runner-sneakers",
      category: "Sneakers",
      description: "Lightweight red runner for everyday wear.",
      price: "68500",
      stockCount: 0,
      placement: "RECOMMENDED",
    }),
    createProduct(business.id, {
      name: "Phone accessory bundle",
      slug: "phone-accessory-bundle",
      category: "Phone accessories",
      description: "Charging and protection essentials.",
      price: "18000",
      stockCount: 8,
      placement: "LATEST_ARRIVAL",
    }),
    createProduct(business.id, {
      name: "Essential cotton tee",
      slug: "essential-cotton-tee",
      category: "Fashion",
      description: "Relaxed everyday cotton tee.",
      price: "12500",
      stockCount: 5,
      placement: "STANDARD",
      status: "DRAFT",
    }),
  ]);
  const product = Object.fromEntries(
    products.map((entry) => [entry.name, entry]),
  );

  await createSale(business.id, user.id, {
    referenceCode: "LL-2051",
    customerId: customer["Amaka Okafor"].id,
    product: product["Black Opium perfume"],
    channel: "WHATSAPP",
    deliveryFee: "2500",
    amountPaid: "44500",
    paymentStatus: "PAID",
    receiptStatus: "SENT",
    deliveryStatus: "IN_TRANSIT",
    soldAt: daysAgo(1),
  });
  await createSale(business.id, user.id, {
    referenceCode: "LL-2050",
    customerId: customer["Nneka Eze"].id,
    product: product["Red runner sneakers"],
    channel: "INSTAGRAM",
    deliveryFee: "0",
    amountPaid: "68500",
    paymentStatus: "PAID",
    receiptStatus: "VIEWED",
    deliveryStatus: "DELIVERED",
    soldAt: daysAgo(2),
  });
  await createSale(business.id, user.id, {
    referenceCode: "LL-2049",
    customerId: customer["Chidi Paul"].id,
    product: product["Phone accessory bundle"],
    channel: "REFERRAL",
    deliveryFee: "2500",
    amountPaid: "0",
    paymentStatus: "UNPAID",
    receiptStatus: "CREATED",
    deliveryStatus: "PREPARING",
    soldAt: daysAgo(2),
  });
  await createSale(business.id, user.id, {
    referenceCode: "LL-2048",
    customerId: customer["Aisha Bello"].id,
    product: product["Essential cotton tee"],
    channel: "WHATSAPP",
    deliveryFee: "0",
    amountPaid: "12500",
    paymentStatus: "PAID",
    receiptStatus: "VIEWED",
    deliveryStatus: "CONFIRMED",
    soldAt: daysAgo(6),
    rating: 5,
  });

  await prisma.followUpTemplate.createMany({
    data: [
      {
        businessId: business.id,
        name: "Thank you",
        body: "Thank you for shopping with us. I hope you love your order.",
      },
      {
        businessId: business.id,
        name: "Delivery check-in",
        body: "Hi! Did your order arrive safely?",
      },
      {
        businessId: business.id,
        name: "Restock alert",
        body: "The item you asked about is back in stock.",
      },
    ],
  });
  await prisma.followUpSuggestion.createMany({
    data: [
      {
        businessId: business.id,
        customerId: customer["Amaka Okafor"].id,
        reason: "Check how the fragrance is working for her",
        status: "SUGGESTED",
        dueAt: daysFromNow(1),
      },
      {
        businessId: business.id,
        customerId: customer["Nneka Eze"].id,
        reason: "Ask whether the sneaker size was comfortable",
        status: "SUGGESTED",
        dueAt: daysFromNow(2),
      },
      {
        businessId: business.id,
        customerId: customer["Chidi Paul"].id,
        reason: "Follow up after delivery",
        status: "APPROVED",
        approvedAt: new Date(),
        dueAt: daysFromNow(1),
      },
      {
        businessId: business.id,
        customerId: customer["Aisha Bello"].id,
        reason: "Share the next cotton tee colour drop",
        status: "SUGGESTED",
        dueAt: daysFromNow(5),
      },
    ],
  });

  const requestToken = "demo-request-token";
  await prisma.orderRequest.create({
    data: {
      businessId: business.id,
      referenceCode: "REQ-DEMO-01",
      tokenHash: hashToken(requestToken),
      customerName: "Mariam Yusuf",
      customerPhone: "+2348059001122",
      channel: "INSTAGRAM",
      note: "Please confirm whether the perfume is available for Friday.",
      items: {
        create: {
          productId: product["Black Opium perfume"].id,
          name: product["Black Opium perfume"].name,
          quantity: 1,
          unitPrice: product["Black Opium perfume"].price,
          total: product["Black Opium perfume"].price,
        },
      },
    },
  });

  printSeedInfo({ action: "created" });
}

function printSeedInfo(extra: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify(
      {
        ...extra,
        ownerEmail: DEMO_EMAIL,
        ownerPassword: DEMO_PASSWORD,
        businessSlug: DEMO_SLUG,
        requestToken: "demo-request-token",
        receiptTokens: [
          "demo-receipt-LL-2051",
          "demo-receipt-LL-2050",
          "demo-receipt-LL-2049",
          "demo-receipt-LL-2048",
        ],
        deliveryTokens: [
          "demo-delivery-LL-2051",
          "demo-delivery-LL-2050",
          "demo-delivery-LL-2049",
          "demo-delivery-LL-2048",
        ],
      },
      null,
      2,
    ),
  );
}

async function resetDemoWorkspace() {
  await prisma.business.deleteMany({ where: { slug: DEMO_SLUG } });
  await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } });
}

async function createCustomer(
  businessId: string,
  authorId: string,
  input: {
    name: string;
    phone: string;
    channel:
      | "WHATSAPP"
      | "INSTAGRAM"
      | "REFERRAL"
      | "WALK_IN";
    note: string;
    tagIds: string[];
    lastPurchasedAt?: Date;
  },
) {
  return prisma.customer.create({
    data: {
      businessId,
      name: input.name,
      phone: input.phone,
      channel: input.channel,
      publicTokenHash: hashToken(`demo-customer-${input.name}`),
      lastPurchasedAt: input.lastPurchasedAt,
      contacts: {
        create: {
          platform:
            input.channel === "INSTAGRAM"
              ? "INSTAGRAM"
              : input.channel === "WHATSAPP"
                ? "WHATSAPP"
                : "PHONE",
          value: input.phone,
          isPrimary: true,
        },
      },
      notes: { create: { authorId, content: input.note } },
      tagAssignments: input.tagIds.length
        ? {
            create: input.tagIds.map((tagId) => ({
              tag: { connect: { id: tagId } },
            })),
          }
        : undefined,
    },
  });
}

function createProduct(
  businessId: string,
  input: {
    name: string;
    slug: string;
    category: string;
    description: string;
    price: string;
    stockCount: number;
    placement: "STANDARD" | "TRENDING" | "RECOMMENDED" | "LATEST_ARRIVAL";
    status?: "ACTIVE" | "DRAFT";
  },
) {
  return prisma.product.create({
    data: {
      businessId,
      ...input,
      status: input.status ?? "ACTIVE",
      visibility: input.status === "DRAFT" ? "PRIVATE" : "PUBLIC",
    },
  });
}

async function createSale(
  businessId: string,
  actorId: string,
  input: {
    referenceCode: string;
    customerId: string;
    product: { id: string; name: string; price: { toString(): string } };
    channel: "WHATSAPP" | "INSTAGRAM" | "REFERRAL";
    deliveryFee: string;
    amountPaid: string;
    paymentStatus: "PAID" | "UNPAID";
    receiptStatus: "CREATED" | "SENT" | "VIEWED";
    deliveryStatus:
      | "PREPARING"
      | "IN_TRANSIT"
      | "DELIVERED"
      | "CONFIRMED";
    soldAt: Date;
    rating?: number;
  },
) {
  const subtotal = Number(input.product.price.toString());
  const total = subtotal + Number(input.deliveryFee);
  const receiptToken = `demo-receipt-${input.referenceCode}`;
  const deliveryToken = `demo-delivery-${input.referenceCode}`;
  const sale = await prisma.sale.create({
    data: {
      businessId,
      customerId: input.customerId,
      referenceCode: input.referenceCode,
      status: "COMPLETED",
      paymentStatus: input.paymentStatus,
      channel: input.channel,
      fulfillment: "DELIVERY",
      subtotal,
      deliveryFee: input.deliveryFee,
      total,
      amountPaid: input.amountPaid,
      soldAt: input.soldAt,
      items: {
        create: {
          productId: input.product.id,
          name: input.product.name,
          quantity: 1,
          unitPrice: input.product.price.toString(),
          total: input.product.price.toString(),
        },
      },
      payments:
        Number(input.amountPaid) > 0
          ? {
              create: {
                recordedById: actorId,
                type: "PAYMENT",
                amount: input.amountPaid,
                note: "Seeded payment",
              },
            }
          : undefined,
      receipt: {
        create: {
          businessId,
          customerId: input.customerId,
          receiptCode: `RCP-${input.referenceCode}`,
          tokenHash: hashToken(receiptToken),
          status: input.receiptStatus,
          sentAt:
            input.receiptStatus === "SENT" || input.receiptStatus === "VIEWED"
              ? input.soldAt
              : undefined,
          viewedAt:
            input.receiptStatus === "VIEWED" ? input.soldAt : undefined,
        },
      },
      delivery: {
        create: {
          businessId,
          customerId: input.customerId,
          tokenHash: hashToken(deliveryToken),
          status: input.deliveryStatus,
          deliveredAt:
            input.deliveryStatus === "DELIVERED" ||
            input.deliveryStatus === "CONFIRMED"
              ? input.soldAt
              : undefined,
          confirmedAt:
            input.deliveryStatus === "CONFIRMED" ? input.soldAt : undefined,
          events: {
            create: {
              actorId,
              status: input.deliveryStatus,
              note: "Seeded delivery state",
            },
          },
        },
      },
    },
    include: { receipt: true, delivery: true },
  });

  const activity = await createActivity(
    businessId,
    actorId,
    "SALE_LOGGED",
    `Logged sale ${input.referenceCode}`,
    { customerId: input.customerId, saleId: sale.id },
  );
  await awardTrust(businessId, activity.id, "sale-logged", 15);

  if (input.receiptStatus !== "CREATED" && sale.receipt) {
    const receiptActivity = await createActivity(
      businessId,
      actorId,
      "RECEIPT_SENT",
      `Shared receipt RCP-${input.referenceCode}`,
      {
        customerId: input.customerId,
        saleId: sale.id,
        receiptId: sale.receipt.id,
      },
    );
    await awardTrust(
      businessId,
      receiptActivity.id,
      "receipt-first-sent",
      15,
    );
  }

  if (input.deliveryStatus === "CONFIRMED" && sale.delivery) {
    const deliveryActivity = await createActivity(
      businessId,
      undefined,
      "DELIVERY_CONFIRMED",
      "Customer confirmed delivery",
      {
        customerId: input.customerId,
        saleId: sale.id,
        deliveryId: sale.delivery.id,
      },
    );
    await awardTrust(
      businessId,
      deliveryActivity.id,
      "delivery-confirmed",
      20,
    );
    if (input.rating) {
      await prisma.customerFeedback.create({
        data: {
          businessId,
          customerId: input.customerId,
          saleId: sale.id,
          deliveryId: sale.delivery.id,
          rating: input.rating,
          comment: "Everything arrived clearly and on time.",
        },
      });
      const feedbackActivity = await createActivity(
        businessId,
        undefined,
        "FEEDBACK_SUBMITTED",
        "Customer feedback submitted",
        {
          customerId: input.customerId,
          saleId: sale.id,
          deliveryId: sale.delivery.id,
        },
      );
      await awardTrust(
        businessId,
        feedbackActivity.id,
        "feedback-submitted",
        10,
      );
    }
  }
}

function createActivity(
  businessId: string,
  actorId: string | undefined,
  type: ActivityEventType,
  title: string,
  relations: {
    customerId?: string;
    saleId?: string;
    receiptId?: string;
    deliveryId?: string;
  },
) {
  return prisma.activityEvent.create({
    data: { businessId, actorId, type, title, ...relations },
  });
}

function awardTrust(
  businessId: string,
  activityEventId: string,
  ruleKey: string,
  points: number,
) {
  return prisma.trustLedgerEntry.create({
    data: { businessId, activityEventId, ruleKey, points },
  });
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
