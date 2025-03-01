import express, { Request } from "express";
import sequelize from "./config/sequelize";
import * as dotevnv from "dotenv"
import cors, { CorsOptions } from "cors"
import morgan from "morgan"
import * as helmet from "helmet"

dotevnv.config()

const app = express();
const PORT = process.env.PORT || 5000

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const corsOptions: CorsOptions = {
  origin: ["https://www.theloyalloop.com", "http://localhost:3000"], // Change to specific domains in production
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};


app.use(cors<Request>(corsOptions));
app.options("*", cors(corsOptions));
app.use(morgan("dev"));
// app.use(helmet());

//  Test database connection
(async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({alter: true});
    console.log("Database connected!");
  } catch (error) {
    console.error("Unable to connect to the database:", error);
  }
})();

import waitlistRouter from "./routes/waitlist.route"

app.use('/waitlist', waitlistRouter)


app.listen(PORT, () => {
    console.log(`Running on Port ${PORT}`);
});
  