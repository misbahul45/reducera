import { z } from 'zod';

export const ReminderToggleDto = z.object({ enabled: z.boolean() }).strict();
export type ReminderToggle = z.infer<typeof ReminderToggleDto>;
