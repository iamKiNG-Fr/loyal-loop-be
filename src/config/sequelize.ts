import { Sequelize } from "sequelize-typescript";
import models from "../models";

const sequelize = new Sequelize({
  dialect: "postgres",
  host: "localhost",
  username: `postgres`,
  password: `password`,
  database: `loyalloop`,
  models // Register all models here
});

export default sequelize;