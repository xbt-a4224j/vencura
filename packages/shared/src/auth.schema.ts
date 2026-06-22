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

/** The placeholder password hashed for the seeded admin/master account. The admin is normally
 *  entered via a passwordless minted session; this only exists because the column is non-null
 *  (and lets SDK example scripts log in as the admin). Not used by the web user flow. */
export const SEED_PASSWORD = 'seed-password';

/** The seeded operator account. It's an `isSystem` account, NOT a regular user — it never appears
 *  in the User view (which is for self-registered, non-admin accounts). The single source of truth
 *  for "who is the admin", so the role check lives in one place. */
export const ADMIN_EMAIL = 'admin@vencura.local';
