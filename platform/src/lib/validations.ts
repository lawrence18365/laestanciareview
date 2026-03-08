import { z } from 'zod';

// Review submission — customer taps NFC card, selects stars
export const submitReviewSchema = z.object({
  restaurantSlug: z.string().min(1).max(100),
  staffCode: z.string().min(1).max(50),
  rating: z.number().int().min(1).max(5),
});

// Feedback form — customer leaves name/email/comments after low rating
export const submitFeedbackSchema = z.object({
  reviewId: z.number().int().positive(),
  customerName: z.string().max(200).optional(),
  customerEmail: z.string().email().max(254).optional(),
  feedback: z.string().min(1).max(5000),
});

// Staff management
export const createStaffSchema = z.object({
  restaurantSlug: z.string().min(1).max(100),
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
});

export const updateStaffSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(50).optional(),
  active: z.boolean().optional(),
});

// Restaurant management
export const createRestaurantSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  managerEmail: z.string().email().max(254).optional(),
  googleReviewUrl: z.string().url().max(500).optional(),
  googleThreshold: z.number().int().min(1).max(5).optional(),
  adminPassword: z.string().min(8).max(128).optional(),
});

// Settings update
export const updateSettingsSchema = z.object({
  googleReviewUrl: z.string().url().max(500).optional(),
  googleThreshold: z.number().int().min(1).max(5).optional(),
  managerEmail: z.string().email().max(254).optional(),
});
