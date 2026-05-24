import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { rateLimit } from "@/lib/rate-limit";

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

// Role cache TTL — refresh session role from DB at most every 5 minutes per session
const ROLE_CACHE_TTL_MS = 5 * 60 * 1000;

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

        const ip = extractIp(req as Record<string, unknown>) ?? "unknown";
        const byEmail = rateLimit(`login:email:${email.toLowerCase()}`, 5, 300);
        const byIp = rateLimit(`login:ip:${ip}`, 30, 300);
        if (!byEmail.ok || !byIp.ok) {
          await recordLogin(email, false, null, req as Record<string, unknown>);
          throw new Error("RATE_LIMIT");
        }

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
        token.role = (user as { role?: string }).role;
        token.roleCheckedAt = Date.now();
      }
      // Refresh role from DB at most every ROLE_CACHE_TTL_MS instead of every request
      const lastChecked = (token.roleCheckedAt as number | undefined) ?? 0;
      if (token.id && Date.now() - lastChecked > ROLE_CACHE_TTL_MS) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { role: true, approved: true, isBusinessApproved: true },
          });
          if (dbUser) {
            token.role = dbUser.role;
            token.isBusinessApproved = dbUser.isBusinessApproved;
          }
          token.roleCheckedAt = Date.now();
        } catch {}
      }
      return token;
    },
    session({ session, token }) {
      if (token && session.user) {
        (session.user as { id?: string }).id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
        (session.user as { isBusinessApproved?: boolean }).isBusinessApproved = !!token.isBusinessApproved;
      }
      return session;
    },
  },
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === "production" ? "__Secure-next-auth.session-token" : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
