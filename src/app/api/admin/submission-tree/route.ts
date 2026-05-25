import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, isNextResponse } from "@/lib/auth-guard";

// 어드민 대시보드 "제출 트리" 탭용 — SubmissionRoute.parentUserId 기반 상위↔하위 회원 매핑 트리.
// 같은 owner 가 매핑마다 다른 parentUser 를 가질 수 있어 단일 hierarchy 가 아닌 다대다 트리.
// parentUser 별로 묶고 그 아래 ownerUser 별로 다시 묶은 mappings 배열 반환.
//
// 응답 구조:
// {
//   parents: [
//     { parent: { id, name, email, isBusinessApproved },
//       children: [
//         { owner: { id, name, email },
//           routes: [{ id, clientName, companyName, submissionEntity, active }] }
//       ] }
//   ],
//   unlinked: { owners: [{ owner, routes }] }   // parentUserId=null
// }

export async function GET() {
  const guard = await requireAdmin();
  if (isNextResponse(guard)) return guard;

  const rows = await prisma.submissionRoute.findMany({
    select: {
      id: true,
      ownerId: true,
      clientName: true,
      companyName: true,
      submissionEntity: true,
      parentUserId: true,
      active: true,
      owner: { select: { id: true, name: true, email: true, isBusinessApproved: true } },
      parentUser: { select: { id: true, name: true, email: true, isBusinessApproved: true } },
    },
    orderBy: [{ submissionEntity: "asc" }, { clientName: "asc" }],
  });

  type UserLite = { id: string; name: string | null; email: string; isBusinessApproved?: boolean | null };
  type RouteLite = { id: string; clientName: string; companyName: string; submissionEntity: string; active: boolean };
  type ChildBucket = { owner: UserLite; routes: RouteLite[] };
  type ParentBucket = { parent: UserLite; children: Map<string, ChildBucket> };

  const parentMap = new Map<string, ParentBucket>();
  const unlinkedMap = new Map<string, ChildBucket>();

  for (const r of rows) {
    const route: RouteLite = {
      id: r.id,
      clientName: r.clientName,
      companyName: r.companyName,
      submissionEntity: r.submissionEntity,
      active: r.active,
    };

    if (r.parentUserId && r.parentUser) {
      const parentKey = r.parentUserId;
      const pb = parentMap.get(parentKey) ?? {
        parent: r.parentUser,
        children: new Map<string, ChildBucket>(),
      };
      const ownerKey = r.ownerId;
      const cb: ChildBucket = pb.children.get(ownerKey) ?? { owner: r.owner, routes: [] };
      cb.routes.push(route);
      pb.children.set(ownerKey, cb);
      parentMap.set(parentKey, pb);
    } else {
      const ownerKey = r.ownerId;
      const cb: ChildBucket = unlinkedMap.get(ownerKey) ?? { owner: r.owner, routes: [] };
      cb.routes.push(route);
      unlinkedMap.set(ownerKey, cb);
    }
  }

  // 정렬 — 상위는 이름순, 하위 owner 도 이름순.
  const sortByName = (a: UserLite, b: UserLite) =>
    (a.name || a.email).localeCompare(b.name || b.email);

  const parents = Array.from(parentMap.values())
    .map((pb) => ({
      parent: pb.parent,
      childCount: pb.children.size,
      routeCount: Array.from(pb.children.values()).reduce((s, c) => s + c.routes.length, 0),
      children: Array.from(pb.children.values()).sort((a, b) => sortByName(a.owner, b.owner)),
    }))
    .sort((a, b) => sortByName(a.parent, b.parent));

  const unlinked = {
    owners: Array.from(unlinkedMap.values()).sort((a, b) => sortByName(a.owner, b.owner)),
    routeCount: Array.from(unlinkedMap.values()).reduce((s, c) => s + c.routes.length, 0),
  };

  return NextResponse.json({
    parents,
    unlinked,
    totals: {
      parentCount: parents.length,
      routeCount: rows.length,
      unlinkedRouteCount: unlinked.routeCount,
    },
  });
}
