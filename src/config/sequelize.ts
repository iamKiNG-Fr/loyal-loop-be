import { Sequelize } from "sequelize-typescript";
import models from "../models";
import "dotenv/config"

const isProduction = process.env.NODE_ENV === "production";

const sequelize = isProduction
  ? new Sequelize(process.env.DATABASE_URL!, {
      dialect: "postgres",
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false, // Needed for some cloud databases
        },
      },
    })
  : new Sequelize({
      dialect: "postgres",
      host: process.env.DB_HOST,
      username: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
    });

// Register models separately
sequelize.addModels(models);

export default sequelize;