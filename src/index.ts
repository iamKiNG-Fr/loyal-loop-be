import express from "express";
import sequelize from "./config/sequelize";
const app = express();
const PORT = process.env.PORT || 5000

import waitlistRouter from "./routes/waitlist"

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

app.use('/waitlist', waitlistRouter)


app.listen(PORT, () => {
    console.log(`Running on Port ${PORT}`);
});
  