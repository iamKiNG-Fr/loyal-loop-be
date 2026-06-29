import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import type { TestingModule } from "@nestjs/testing";
import { AppModule } from "./app.module";

describe("AppModule", () => {
  let module: TestingModule | undefined;

  afterEach(async () => {
    await module?.close();
  });

  it("resolves the complete backend dependency graph", async () => {
    module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(module.get(AppModule)).toBeInstanceOf(AppModule);
  });
});
