import { z } from 'zod';

/** Registration / login input. Password floor is a low 4 chars for this demo (no complexity
 *  rule) — add a real policy for production. Email is normalized to lowercase so logins are
 *  case-insensitive. */
export const RegisterSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(4, 'password must be at least 4 characters'),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = RegisterSchema;
export type LoginInput = z.infer<typeof LoginSchema>;

/** An account, as shown in the User-view account picker (no secrets). */
export interface Account {
  id: string;
  email: string;
}

/** Shared demo password. The User view signs in with this for every account (prepopulated,
 *  one click), and the seed + admin "create account" register accounts with it. Demo-only —
 *  the deployment perimeter (Vercel Authentication) is the real security boundary. */
export const DEMO_PASSWORD = 'demo-password';

/** The seeded operator account. It's an `isDemo` account, NOT a regular user — it never appears
 *  in the User view (which is for self-registered, non-admin accounts). The single source of truth
 *  for "who is the admin", so the role check lives in one place. */
export const ADMIN_EMAIL = 'admin@vencura.local';
