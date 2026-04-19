/**
 * 用户存储 — 用户 CRUD + 密码哈希 + JWT 生成
 *
 * 使用 Node.js crypto 模块实现密码哈希（scrypt），
 * 不引入 bcrypt 等外部依赖。
 *
 * 学习重点：
 * - scrypt 是 Node.js 内置的密码哈希算法，抗 GPU/ASIC 暴力破解
 * - JWT 生成使用 HMAC-SHA256，与现有 auth 模块的验证逻辑对齐
 * - 用户 ID 使用 crypto.randomUUID()，全局唯一
 */

import { scryptSync, randomBytes, createHmac } from 'node:crypto'
import { getDb } from '../db/connection.js'

// ===== 类型 =====

export interface User {
  id: string
  email: string
  displayName: string
  createdAt: number
  updatedAt: number
}

export interface UserWithHash extends User {
  passwordHash: string
}

export type UserRole = 'owner' | 'admin' | 'member' | 'viewer'

export interface OrgMember {
  orgId: string
  userId: string
  role: UserRole
  joinedAt: number
}

export interface Organization {
  id: string
  name: string
  slug: string
  createdAt: number
}

// ===== 密码哈希 =====

const SALT_LENGTH = 16
const KEY_LENGTH = 64

/** 哈希密码 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH).toString('hex')
  const derivedKey = scryptSync(password, salt, KEY_LENGTH).toString('hex')
  return `${salt}:${derivedKey}`
}

/** 验证密码 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, storedKey] = storedHash.split(':')
  if (!salt || !storedKey) return false
  const derivedKey = scryptSync(password, salt, KEY_LENGTH).toString('hex')
  return derivedKey === storedKey
}

// ===== JWT =====

/** 生成 JWT Token */
export function generateJwt(payload: { userId: string; email: string; orgId?: string }): string {
  const secret = process.env.CHITU_JWT_SECRET || 'dev-secret-change-me'
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400 * 7, // 7 天过期
  })).toString('base64url')
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url')
  return `${header}.${body}.${signature}`
}

// ===== 用户 CRUD =====

/** 注册新用户 */
export async function registerUser(email: string, password: string, displayName?: string): Promise<{ user: User; token: string }> {
  const sql = getDb()
  const id = randomBytes(16).toString('hex')
  const now = Date.now()
  const passwordHash = hashPassword(password)
  const name = displayName || email.split('@')[0]

  await sql`
    INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at)
    VALUES (${id}, ${email}, ${name}, ${passwordHash}, ${now}, ${now})
  `

  const token = generateJwt({ userId: id, email })

  // 为新用户创建个人组织
  const orgId = randomBytes(16).toString('hex')
  const slug = `personal-${id.slice(0, 8)}`
  await sql`
    INSERT INTO organizations (id, name, slug, created_at)
    VALUES (${orgId}, ${name}, ${slug}, ${now})
  `
  await sql`
    INSERT INTO org_members (org_id, user_id, role, joined_at)
    VALUES (${orgId}, ${id}, 'owner', ${now})
  `

  return {
    user: { id, email, displayName: name, createdAt: now, updatedAt: now },
    token,
  }
}

/** 用户登录 */
export async function loginUser(email: string, password: string): Promise<{ user: User; token: string }> {
  const sql = getDb()

  const rows = await sql`
    SELECT id, email, display_name, password_hash, created_at, updated_at
    FROM users WHERE email = ${email}
  `

  if (rows.length === 0) {
    throw new Error('用户不存在')
  }

  const row = rows[0] as any
  if (!verifyPassword(password, row.password_hash)) {
    throw new Error('密码错误')
  }

  const user: User = {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }

  // 查找用户的个人组织
  const orgRows = await sql`
    SELECT om.org_id FROM org_members om
    JOIN organizations o ON o.id = om.org_id
    WHERE om.user_id = ${user.id} AND om.role = 'owner'
    ORDER BY o.created_at ASC LIMIT 1
  `
  const orgId = (orgRows[0] as any)?.org_id

  const token = generateJwt({ userId: user.id, email: user.email, orgId })

  return { user, token }
}

/** 通过 ID 获取用户 */
export async function getUserById(id: string): Promise<User | null> {
  const sql = getDb()
  const rows = await sql`
    SELECT id, email, display_name, created_at, updated_at
    FROM users WHERE id = ${id}
  `
  if (rows.length === 0) return null
  const row = rows[0] as any
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** 列出所有用户 */
export async function listUsers(): Promise<User[]> {
  const sql = getDb()
  const rows = await sql`
    SELECT id, email, display_name, created_at, updated_at
    FROM users ORDER BY created_at DESC
  `
  return (rows as any[]).map(row => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

// ===== 组织 CRUD =====

/** 创建组织 */
export async function createOrganization(name: string, slug: string, ownerId: string): Promise<Organization> {
  const sql = getDb()
  const id = randomBytes(16).toString('hex')
  const now = Date.now()

  await sql`
    INSERT INTO organizations (id, name, slug, created_at)
    VALUES (${id}, ${name}, ${slug}, ${now})
  `
  await sql`
    INSERT INTO org_members (org_id, user_id, role, joined_at)
    VALUES (${id}, ${ownerId}, 'owner', ${now})
  `

  return { id, name, slug, createdAt: now }
}

/** 获取用户所属的组织列表 */
export async function listUserOrganizations(userId: string): Promise<Array<Organization & { role: UserRole }>> {
  const sql = getDb()
  const rows = await sql`
    SELECT o.id, o.name, o.slug, o.created_at, om.role
    FROM organizations o
    JOIN org_members om ON o.id = om.org_id
    WHERE om.user_id = ${userId}
    ORDER BY o.created_at ASC
  `
  return (rows as any[]).map(row => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.created_at,
    role: row.role as UserRole,
  }))
}

/** 邀请用户加入组织 */
export async function inviteToOrganization(orgId: string, userId: string, role: UserRole = 'member'): Promise<void> {
  const sql = getDb()
  const now = Date.now()
  await sql`
    INSERT INTO org_members (org_id, user_id, role, joined_at)
    VALUES (${orgId}, ${userId}, ${role}, ${now})
    ON CONFLICT (org_id, user_id) DO UPDATE SET role = ${role}
  `
}

/** 获取组织成员列表 */
export async function listOrgMembers(orgId: string): Promise<Array<OrgMember & { email: string; displayName: string }>> {
  const sql = getDb()
  const rows = await sql`
    SELECT om.org_id, om.user_id, om.role, om.joined_at,
           u.email, u.display_name
    FROM org_members om
    JOIN users u ON u.id = om.user_id
    WHERE om.org_id = ${orgId}
    ORDER BY om.joined_at ASC
  `
  return (rows as any[]).map(row => ({
    orgId: row.org_id,
    userId: row.user_id,
    role: row.role as UserRole,
    joinedAt: row.joined_at,
    email: row.email,
    displayName: row.display_name,
  }))
}

/** 检查用户在组织中的角色 */
export async function getUserRole(orgId: string, userId: string): Promise<UserRole | null> {
  const sql = getDb()
  const rows = await sql`
    SELECT role FROM org_members
    WHERE org_id = ${orgId} AND user_id = ${userId}
  `
  if (rows.length === 0) return null
  return (rows[0] as any).role as UserRole
}

/** 从 JWT payload 中解析用户 ID */
export function parseJwtPayload(token: string): { userId: string; email: string; orgId?: string } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    return { userId: payload.userId, email: payload.email, orgId: payload.orgId }
  } catch {
    return null
  }
}
