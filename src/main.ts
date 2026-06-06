import "reflect-metadata";
import helmet from "helmet";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const trustProxy = configService.get<string>("TRUST_PROXY");

  if (trustProxy) {
    app
      .getHttpAdapter()
      .getInstance()
      .set("trust proxy", parseTrustProxy(trustProxy));
  }

  app.setGlobalPrefix("api/v1");

  const corsOrigins = configService
    .get<string>(
      "CORS_ORIGINS",
      "https://useloyalloop.com,https://www.useloyalloop.com,http://localhost:3000",
    )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(helmet());
  app.enableCors({
    origin: corsOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = configService.get<number>("PORT", 5000);
  await app.listen(port);
}

void bootstrap();

function parseTrustProxy(value: string) {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : value;
}
