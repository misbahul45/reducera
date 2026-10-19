import { PrismaService } from '@/common/config/prisma/prisma.service';
import { themeSchemePairSchema } from '@/v1/gamify/themes/theme.schema';
import { UserThemeService } from '@/v1/gamify/themes/user-theme.service';
import { generateUserTheme } from '@/v1/gamify/themes/user-theme-palette';
import { createPool, databaseUrl, describeDb, expectViolation, insertUser, withRollback } from '@/test-utils/pg-fixtures';
import { Pool } from 'pg';

describeDb('per-user theme (requires TEST_DATABASE_URL)', () => {
  let prisma: PrismaService;
  let pool: Pool;
  let service: UserThemeService;
  const users: string[] = [];

  const newUser = async () => {
    const id = await insertUser(pool, 'STUDENT');
    users.push(id);
    return id;
  };

  const rowsOf = (userId: string) => pool.query('SELECT * FROM "UserTheme" WHERE "userId" = $1', [userId]).then((result) => result.rows);

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    pool = createPool();
    service = new UserThemeService(prisma);
  }, 120_000);

  afterAll(async () => {
    await pool.query('DELETE FROM "User" WHERE id = ANY($1::text[])', [users]);
    await prisma.$disconnect();
    await pool.end();
  });

  it('starts with no custom theme', async () => {
    const userId = await newUser();

    expect((await service.get(userId)).data).toEqual({ custom: false, mood: [], intensity: null, theme: null });
  });

  it('stores the generated theme, reads it back, and keeps one row per learner when saved again', async () => {
    const userId = await newUser();

    await service.save(userId, { mood: ['playful', 'calm'], intensity: 30 });
    const first = (await service.get(userId)).data;
    await service.save(userId, { mood: ['natural'], intensity: 90 });
    const second = (await service.get(userId)).data;

    expect(first.mood).toEqual(['calm', 'playful']);
    expect(first.intensity).toBe(30);
    expect(first.theme?.tokens).toEqual(generateUserTheme({ mood: ['calm', 'playful'], intensity: 30 }).tokens);
    expect(second.mood).toEqual(['natural']);
    expect(second.theme?.tokens).toEqual(generateUserTheme({ mood: ['natural'], intensity: 90 }).tokens);
    expect(await rowsOf(userId)).toHaveLength(1);
  });

  it('stores tokens that satisfy the theme schema, so the web resolver can read them', async () => {
    const userId = await newUser();
    await service.save(userId, { mood: ['serious', 'analytical', 'mysterious'], intensity: 100 });

    const [row] = await rowsOf(userId);

    expect(() => themeSchemePairSchema.parse(row.tokens)).not.toThrow();
    expect(row.generatorVersion).toBe(1);
  });

  it('keeps learners apart: a save or a reset touches only the caller', async () => {
    const [one, two] = [await newUser(), await newUser()];
    await service.save(one, { mood: ['calm'], intensity: 10 });
    await service.save(two, { mood: ['energetic'], intensity: 80 });

    await service.reset(one);

    expect((await service.get(one)).data.custom).toBe(false);
    expect((await service.get(two)).data.mood).toEqual(['energetic']);
  });

  it('answers a reset the same when there was nothing to remove', async () => {
    const userId = await newUser();

    await service.reset(userId);
    await service.save(userId, { mood: ['calm'], intensity: 50 });
    await service.reset(userId);
    const again = await service.reset(userId);

    expect(again.data.custom).toBe(false);
    expect(await rowsOf(userId)).toHaveLength(0);
  });

  it('removes the theme with the account', async () => {
    const userId = await newUser();
    await service.save(userId, { mood: ['calm'], intensity: 50 });

    await pool.query('DELETE FROM "User" WHERE id = $1', [userId]);

    expect(await rowsOf(userId)).toHaveLength(0);
  });

  describe('database rules', () => {
    const insert = (client: Pool | import('pg').PoolClient, userId: string, mood: string[], intensity: number) =>
      client.query(
        `INSERT INTO "UserTheme" ("userId", mood, intensity, tokens, atmosphere, variants, "updatedAt")
         VALUES ($1, $2::text[], $3, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, now())`,
        [userId, mood, intensity],
      );

    it.each([
      ['no mood', [], 50, 'UserTheme_mood_count'],
      ['four moods', ['calm', 'playful', 'serious', 'natural'], 50, 'UserTheme_mood_count'],
      ['an unknown mood', ['sleepy'], 50, 'UserTheme_mood_known'],
      ['an intensity above 100', ['calm'], 101, 'UserTheme_intensity_range'],
      ['a negative intensity', ['calm'], -1, 'UserTheme_intensity_range'],
    ])('refuses %s', async (_label, mood, intensity, constraint) => {
      const userId = await newUser();

      await withRollback(pool, async (client) => {
        const violation = await expectViolation(client, `INSERT INTO "UserTheme" ("userId", mood, intensity, tokens, atmosphere, variants, "updatedAt") VALUES ($1, $2::text[], $3, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, now())`, [userId, mood, intensity]);
        expect(violation.constraint).toBe(constraint);
      });
    });

    it('accepts three moods and the two ends of the intensity', async () => {
      const [a, b] = [await newUser(), await newUser()];

      await withRollback(pool, async (client) => {
        await insert(client, a, ['calm', 'playful', 'serious'], 0);
        await insert(client, b, ['natural'], 100);
      });
    });
  });
});
