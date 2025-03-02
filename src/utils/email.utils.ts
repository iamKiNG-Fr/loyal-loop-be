import sgMail, { MailDataRequired } from "@sendgrid/mail";
import dotenv from "dotenv";

dotenv.config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY as string);

export class EmailService {
  static async sendEmail(
    to: string,
    name: string,
    businessName: string,
    refCode: string
  ) {
    try {
      const msg: MailDataRequired = {
        from: {
          email: process.env.SENDER_EMAIL as string,
          name: "King from Loyal Loop",
        },
        personalizations: [
          {
            to: [
              {
                email: to,
              },
            ],
            dynamicTemplateData: {
              subject: `Welcome to the Loyal Loop, ${name}! 🚀`,
              name,
              businessName,
              refLink: `https://theloyalloop.com/waitlist?code=${refCode}`,
            },
          },
        ],
        templateId: "d-d1a8fec0376c485a8985ca47e00a22ae",
      };

      await sgMail.send(msg);
    } catch (error) {
      console.error("❌ Error sending email:", error);
      throw new Error("Email sending failed");
    }
  }
}
