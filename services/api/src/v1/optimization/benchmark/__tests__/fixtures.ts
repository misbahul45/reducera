import { readFileSync } from 'fs';
import { join } from 'path';

export const BUILTIN_PROMPT_BODY = readFileSync(join(process.cwd(), 'prisma', 'seed-data', 'prompt-templates', 'tutor-chat.txt'), 'utf8');
