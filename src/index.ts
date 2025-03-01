import express, { Request } from "express";
import sequelize from "./config/sequelize";
import * as dotevnv from "dotenv"
import cors, { CorsOptions } from "cors"
import * as helmet from "helmet"

dotevnv.config()

const app = express();
const PORT = process.env.PORT || 5000

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const corsOptions: CorsOptions = {
  origin: "*", // Change to specific domains in production
  methods: ["GET", "POST", "PUT", "DELETE"],
  // allowedHeaders: ["Content-Type", "Authorization"],
};


app.use(cors<Request>(corsOptions));
// app.use(helmet())

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
  