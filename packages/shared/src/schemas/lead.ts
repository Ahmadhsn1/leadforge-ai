import { z } from 'zod';
import {
  CHANNELS,
  DRAFT_KINDS,
  LEAD_STATUSES,
  SOCIAL_PLATFORMS,
  TEMPERATURES,
  VERIFICATION_STATUSES,
} from '../domain/enums';
import { optionalTrimmed, paginationSchema, trimmed } from './common';

export const listLeadsSchema = paginationSchema.extend({
  campaignId: z.string().optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  verificationStatus: z.enum(VERIFICATION_STATUSES).optional(),
  temperature: z.enum(TEMPERATURES).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  maxScore: z.coerce.number().int().min(0).max(100).optional(),
  hasWebsite: z.coerce.boolean().optional(),
  search: optionalTrimmed(160),
  tag: optionalTrimmed(60),
  sortBy: z.enum(['leadScore', 'createdAt', 'updatedAt', 'canonicalName']).default('leadScore'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type ListLeadsQuery = z.infer<typeof listLeadsSchema>;

export const updateLeadSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  phone: optionalTrimmed(40),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  website: optionalTrimmed(500),
  notes: optionalTrimmed(4_000),
  tags: z.array(trimmed(60)).max(30).optional(),
  ownerId: z.string().optional(),
});
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const analyzeLeadSchema = z.object({
  /** Re-run analysis even if a current report exists. */
  force: z.boolean().default(false),
  tier: z.enum(['economy', 'balanced', 'quality']).optional(),
});

export const generateMessageSchema = z.object({
  channel: z.enum(CHANNELS),
  kinds: z.array(z.enum(DRAFT_KINDS)).min(1).default(['primary', 'short', 'alternative']),
  tone: z.enum(['professional', 'friendly', 'direct', 'consultative']).optional(),
  cta: optionalTrimmed(200),
  offer: optionalTrimmed(400),
  force: z.boolean().default(false),
});
export type GenerateMessageInput = z.infer<typeof generateMessageSchema>;

export const createNoteSchema = z.object({ body: trimmed(4_000) });

export const createTaskSchema = z.object({
  title: trimmed(200),
  dueAt: z.string().datetime({ offset: true }).optional(),
  assigneeId: z.string().optional(),
});

export const updateTaskSchema = z.object({
  title: optionalTrimmed(200),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  completed: z.boolean().optional(),
});

export const addSocialProfileSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  profileUrl: trimmed(500),
});

export const importLeadsSchema = z.object({
  campaignId: z.string().min(1),
  rows: z
    .array(
      z.object({
        name: trimmed(200),
        phone: optionalTrimmed(40),
        email: optionalTrimmed(254),
        website: optionalTrimmed(500),
        address: optionalTrimmed(400),
        city: optionalTrimmed(120),
        country: optionalTrimmed(2),
        category: optionalTrimmed(120),
      }),
    )
    .min(1)
    .max(1_000),
});
export type ImportLeadsInput = z.infer<typeof importLeadsSchema>;
