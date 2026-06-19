import { z } from 'zod';

/** Registration / login input. Password floor is deliberately low for demo seeding;
 *  raise for production. Email is normalized to lowercase so logins are case-insensitive. */
export const RegisterSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8, 'password must be at least 8 characters'),
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
