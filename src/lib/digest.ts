import { prisma } from "@/lib/prisma";

export async function pushDigest({
  type,
  category,
  title,
  body,
  decisionOptions,
}: {
  type: "completed" | "decision_needed" | "blocker" | "info";
  category: string;
  title: string;
  body: string;
  decisionOptions?: { id: string; label: string }[];
}) {
  return prisma.bizDigestQueue.create({
    data: {
      type,
      category,
      title,
      body,
      decisionOptions: decisionOptions ?? null,
    },
  });
}
