import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

function extractIp(req: Record<string, unknown>): string | null {
  const headers = (req?.headers ?? {}) as Record<string, string | string[] | undefined>;
  const forwarded = headers["x-forwarded-for"];
  if (forwarded) return (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(",")[0].trim();
  return (headers["x-real-ip"] as string) ?? null;
}

async function recordLogin(email: string, success: boolean, userId: string | null, req: Record<string, unknown>) {
  try {
    const headers = (req?.headers ?? {}) as Record<string, string | undefined>;
    await prisma.loginLog.create({
      data: {
        id: randomBytes(12).toString("hex"),
        email,
        success,
        userId: userId ?? null,
        ip: extractIp(req),
        userAgent: headers["user-agent"] ?? null,
      },
    });
  } catch {}
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "이메일", type: "email" },
        password: { label: "비밀번호", type: "password" },
      },
      async authorize(credentials, req) {
        const email = credentials?.email ?? "";
        if (!email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({ where: { email } });

        if (!user) {
          await recordLogin(email, false, null, req as Record<string, unknown>);
          return null;
        }

        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) {
          await recordLogin(email, false, user.id, req as Record<string, unknown>);
          return null;
        }

        if (!user.approved) {
          await recordLogin(email, false, user.id, req as Record<string, unknown>);
          throw new Error("PENDING");
        }

        await recordLogin(email, true, user.id, req as Record<string, unknown>);
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      // 매번 DB에서 최신 역할 조회 (관리자가 변경해도 즉시 반영)
      if (token.id) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { role: true, approved: true },
          });
          if (dbUser) token.role = dbUser.role;
        } catch {}
      }
      return token;
    },
    session({ session, token }) {
      if (token && session.user) {
        (session.user as { id?: string }).id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
};
