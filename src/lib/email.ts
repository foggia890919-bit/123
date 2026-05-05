import nodemailer from "nodemailer";

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? "465");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? user;

  if (!host || !user || !pass) {
    throw new Error("SMTP 환경변수(SMTP_HOST, SMTP_USER, SMTP_PASS)가 설정되지 않았어요.");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({ from, to, subject, html });
}
