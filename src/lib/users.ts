import { getAccessPolicy } from "./access";
import { avatarColumns, type AvatarMode } from "./agent-avatar";
import { appOrigin, notifySlack } from "./alerts";
import type { Role } from "./auth";
import { sql } from "./db";
import type { GoogleIdentity } from "./google-auth";
import { HttpError } from "./http";

export type UserStatus = "pending" | "active" | "disabled";
export const ROLE_LABEL: Record<Role, string> = { admin: "관리자", agent: "상담원" };
export const STATUS_LABEL: Record<UserStatus, string> = { pending: "승인 대기", active: "활성", disabled: "정지" };
export type UserRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  avatar_url: string | null;
  avatar_emoji: string;
  avatar_mode: AvatarMode;
  google_picture: string | null;
  google: boolean;
  password: boolean;
  last_login_at: string | null;
  created_at: string;
};

export function listUsers() {
  return sql<UserRow[]>`
    select id, email, name, role, status, ${avatarColumns()}, avatar_mode, avatar_url as google_picture, google_sub is not null as google,
      password_hash is not null as password, last_login_at, created_at
    from agents
    order by case status when 'pending' then 0 when 'active' then 1 else 2 end, role, name`;
}

// 구글 로그인 결과를 계정에 연결한다.
// - 구글 계정(sub)으로 먼저 찾고, 없으면 같은 이메일 계정(미리 등록·예전 비밀번호 계정)에 연결한다.
//   도메인은 Workspace 가 보증하므로 같은 주소로 다시 만든 구글 계정도 기존 계정에 이어진다.
// - 처음 보는 사용자는 정책에 따라 바로 상담원이 되거나 승인 대기로 만든다.
// - 활성 관리자가 한 명도 없으면 첫 사용자를 관리자로 만든다 (처음 설치 시 잠김 방지).
export async function signInWithGoogle(id: GoogleIdentity) {
  const policy = await getAccessPolicy();
  const result = await sql.begin(async (tx) => {
    const [found] = await tx<{ id: string; name: string; status: UserStatus; google_sub: string | null }[]>`
      select id, name, status, google_sub from agents
      where google_sub = ${id.sub} or email = ${id.email}
      order by (google_sub = ${id.sub}) desc nulls last limit 1 for update`;
    if (found) {
      await tx`
        update agents set google_sub = ${id.sub}, avatar_url = ${id.picture},
          last_login_at = case when status = 'active' then now() else last_login_at end
        where id = ${found.id}`;
      return { id: found.id, name: found.name, status: found.status, created: false };
    }

    await tx`select pg_advisory_xact_lock(hashtext('agents_bootstrap'))`;
    const [{ admins }] = await tx<{ admins: number }[]>`
      select count(*)::int as admins from agents where role = 'admin' and status = 'active'`;
    const role: Role = admins === 0 ? "admin" : "agent";
    const status: UserStatus = admins === 0 || policy.autoApprove ? "active" : "pending";
    const [created] = await tx<{ id: string }[]>`
      insert into agents (email, name, role, status, google_sub, avatar_url, last_login_at)
      values (${id.email}, ${id.name}, ${role}, ${status}, ${id.sub}, ${id.picture},
        ${status === "active" ? sql`now()` : null})
      returning id`;
    return { id: created.id, name: id.name, status, created: true };
  });

  // 사용자 이름은 운영자 정보라 슬랙에 보내도 된다 (고객 정보 아님)
  if (result.created) {
    await notifySlack(
      `user:${result.id}`,
      result.status === "pending"
        ? `:bust_in_silhouette: *${id.name}* 님이 CS-Talk 접속을 요청했어요. 승인: ${appOrigin()}/settings?tab=users`
        : `:bust_in_silhouette: *${id.name}* 님이 CS-Talk 에 처음 로그인했어요.`,
    );
  }
  return result;
}

// 관리자 변경 검사: 자기 자신의 권한·상태는 못 바꾸고, 활성 관리자가 0명이 되면 안 된다.
export async function updateUser(
  actorId: string,
  userId: string,
  patch: { name?: string; role?: Role; status?: UserStatus },
) {
  // 변경 이력용으로 바뀌기 전 값을 돌려준다
  return sql.begin(async (tx) => {
    const [user] = await tx<{ id: string; name: string; role: Role; status: UserStatus }[]>`
      select id, name, role, status from agents where id = ${userId} for update`;
    if (!user) throw new HttpError(404, "not_found");
    if (userId === actorId && (patch.role !== undefined || patch.status !== undefined)) {
      if ((patch.role ?? user.role) !== user.role || (patch.status ?? user.status) !== user.status) {
        throw new HttpError(409, "cannot_change_self");
      }
    }
    const losesAdmin =
      user.role === "admin" &&
      user.status === "active" &&
      ((patch.role && patch.role !== "admin") || (patch.status && patch.status !== "active"));
    if (losesAdmin) {
      await tx`select pg_advisory_xact_lock(hashtext('agents_bootstrap'))`;
      const [{ n }] = await tx<{ n: number }[]>`
        select count(*)::int as n from agents where role = 'admin' and status = 'active' and id <> ${userId}`;
      if (n === 0) throw new HttpError(409, "last_admin");
    }
    await tx`
      update agents set
        name = coalesce(${patch.name ?? null}, name),
        role = coalesce(${patch.role ?? null}, role),
        status = coalesce(${patch.status ?? null}, status)
      where id = ${userId}`;
    return user;
  });
}
