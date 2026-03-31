import { z } from 'zod'

export const CreateCategorySchema = z.object({
  name:     z.string().min(1).max(100),
  color:    z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  position: z.number().int().min(0).optional(),
})

export const PatchCategorySchema = z.object({
  name:     z.string().min(1).max(100).optional(),
  color:    z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  position: z.number().int().min(0).optional(),
})

export const CreateCardSchema = z.object({
  category_id: z.string().uuid(),
  title:       z.string().min(1).max(500),
  summary:     z.string().optional(),
  draft_reply: z.string().optional(),
})

export const PatchCardSchema = z.object({
  category_id:   z.string().uuid().optional(),
  position:      z.number().int().min(0).optional(),
  status:        z.enum(['pending', 'reviewed', 'approved', 'sending', 'done', 'dismissed']).optional(),
  draft_reply:   z.string().optional(),
  snoozed_until: z.string().datetime().nullable().optional(),
})

export const CreateActionSchema = z.object({
  card_id:     z.string().uuid(),
  action_type: z.string().min(1),
  payload:     z.record(z.unknown()),
})
