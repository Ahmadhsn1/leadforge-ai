import { z } from 'zod';
import { ORG_ROLES } from '../domain/enums';
import { trimmed } from './common';

export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(200)
  .refine((v) => /[a-z]/.test(v), 'Password must contain a lowercase letter')
  .refine((v) => /[A-Z]/.test(v), 'Password must contain an uppercase letter')
  .refine((v) => /\d/.test(v), 'Password must contain a number');

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: trimmed(120),
  organizationName: trimmed(120),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const requestPasswordResetSchema = z.object({ email: emailSchema });

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(ORG_ROLES).default('member'),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const updateMemberSchema = z.object({ role: z.enum(ORG_ROLES) });

export const switchOrganizationSchema = z.object({ organizationId: z.string().min(1) });

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly emailVerified: boolean;
}

export interface SessionOrganization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly role: (typeof ORG_ROLES)[number];
  readonly plan: string;
}

export interface AuthContext {
  readonly user: SessionUser;
  readonly organization: SessionOrganization;
  readonly sessionId: string;
  readonly organizations: SessionOrganization[];
}
