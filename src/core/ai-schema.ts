// src/core/ai-schema.ts
import { z } from 'zod';

export const AIAnalysisSchema = z.object({
  product: z.object({
    name: z.string(),
    quantity: z.number().int().positive(),
    dimensions: z.object({
      height_cm: z.number().positive().optional(),
      diameter_cm: z.number().positive().optional()
    }).optional()
  }),
  decoration: z.object({
    pattern: z.string()
  }).optional(),
  glaze: z.object({
    type: z.string(),
    estimated_amount_kg: z.number().positive()
  }),
  clay: z.object({
    type: z.string().nullable(),
    estimated_amount_kg: z.number().positive()
  }),
  firing: z.object({
    temperature_c: z.number().int().positive(),
    estimated_duration_hours: z.number().positive()
  }),
  deadline_days: z.number().int().positive(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
  priority_reason: z.string(),
  extracted_data: z.record(z.string(), z.any()),
  estimated_data: z.record(z.string(), z.any())
});

export type AIAnalysisOutput = z.infer<typeof AIAnalysisSchema>;