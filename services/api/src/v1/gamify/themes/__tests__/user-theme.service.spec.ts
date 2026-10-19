import { PrismaService } from '@/common/config/prisma/prisma.service';
import { themeSchemePairSchema } from '../theme.schema';
import { UserThemeService } from '../user-theme.service';
import { generateUserTheme } from '../user-theme-palette';

interface StoredRow {
  userId: string;
  mood: string[];
  intensity: number;
  tokens: unknown;
  atmosphere: unknown;
  variants: unknown;
  generatorVersion: number;
}

const rowFor = (userId: string, mood: Array<'calm' | 'playful'>, intensity: number): StoredRow => {
  const theme = generateUserTheme({ mood, intensity });
  return { userId, mood: theme.mood, intensity, tokens: theme.tokens, atmosphere: theme.atmosphere, variants: theme.variants, generatorVersion: theme.version };
};

describe('UserThemeService', () => {
  let userTheme: { findUnique: jest.Mock; upsert: jest.Mock; deleteMany: jest.Mock };
  let service: UserThemeService;

  beforeEach(() => {
    userTheme = {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation(({ create }: { create: StoredRow }) => Promise.resolve(create)),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    service = new UserThemeService({ userTheme } as unknown as PrismaService);
  });

  describe('get', () => {
    it('says there is no custom theme when the learner has none', async () => {
      const result = await service.get('learner-1');

      expect(userTheme.findUnique).toHaveBeenCalledWith({ where: { userId: 'learner-1' } });
      expect(result.data).toEqual({ custom: false, mood: [], intensity: null, theme: null });
    });

    it('returns the stored theme in the shape the web resolver reads', async () => {
      userTheme.findUnique.mockResolvedValue(rowFor('learner-1', ['calm'], 40));

      const { data } = await service.get('learner-1');

      expect(data.custom).toBe(true);
      expect(data.mood).toEqual(['calm']);
      expect(data.intensity).toBe(40);
      expect(data.theme).toMatchObject({ slug: 'user-theme', isDefault: false, mood: ['calm'] });
      expect(() => themeSchemePairSchema.parse(data.theme?.tokens)).not.toThrow();
    });

    it('falls back to no custom theme when the stored tokens are damaged', async () => {
      userTheme.findUnique.mockResolvedValue({ ...rowFor('learner-1', ['calm'], 40), tokens: { light: {}, dark: {} } });

      const { data } = await service.get('learner-1');

      expect(data).toEqual({ custom: false, mood: [], intensity: null, theme: null });
    });
  });

  describe('preview', () => {
    it('generates a theme without writing anything', async () => {
      const { data } = await service.preview({ mood: ['playful', 'calm'], intensity: 70 });

      expect(data.mood).toEqual(['calm', 'playful']);
      expect(data.intensity).toBe(70);
      expect(data.theme?.tokens.light.primary).toBe(generateUserTheme({ mood: ['calm', 'playful'], intensity: 70 }).tokens.light.primary);
      expect(userTheme.upsert).not.toHaveBeenCalled();
      expect(userTheme.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('save', () => {
    it('stores the generated theme under the caller id, moods in canonical order', async () => {
      const { data } = await service.save('learner-1', { mood: ['playful', 'calm'], intensity: 70 });
      const call = userTheme.upsert.mock.calls[0][0];
      const expected = generateUserTheme({ mood: ['calm', 'playful'], intensity: 70 });

      expect(call.where).toEqual({ userId: 'learner-1' });
      expect(call.create).toEqual({
        userId: 'learner-1',
        mood: ['calm', 'playful'],
        intensity: 70,
        tokens: expected.tokens,
        atmosphere: expected.atmosphere,
        variants: expected.variants,
        generatorVersion: expected.version,
      });
      expect(call.update).toEqual({
        mood: ['calm', 'playful'],
        intensity: 70,
        tokens: expected.tokens,
        atmosphere: expected.atmosphere,
        variants: expected.variants,
        generatorVersion: expected.version,
      });
      expect(data.custom).toBe(true);
      expect(data.theme?.tokens).toEqual(expected.tokens);
    });

    it('writes the same data when the same choice is saved again', async () => {
      await service.save('learner-1', { mood: ['calm'], intensity: 20 });
      await service.save('learner-1', { mood: ['calm'], intensity: 20 });

      expect(userTheme.upsert.mock.calls[0][0]).toEqual(userTheme.upsert.mock.calls[1][0]);
    });

    it('refuses a choice the generator cannot make', async () => {
      await expect(service.save('learner-1', { mood: [], intensity: 20 })).rejects.toMatchObject({ statusCode: 400 });
      await expect(service.save('learner-1', { mood: ['calm'], intensity: 120 })).rejects.toMatchObject({ statusCode: 400 });
      expect(userTheme.upsert).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('deletes only the caller row and answers the same whether or not one existed', async () => {
      const first = await service.reset('learner-1');
      userTheme.deleteMany.mockResolvedValue({ count: 1 });
      const second = await service.reset('learner-1');

      expect(userTheme.deleteMany).toHaveBeenNthCalledWith(1, { where: { userId: 'learner-1' } });
      expect(userTheme.deleteMany).toHaveBeenNthCalledWith(2, { where: { userId: 'learner-1' } });
      expect(first.data).toEqual({ custom: false, mood: [], intensity: null, theme: null });
      expect(second.data).toEqual(first.data);
    });
  });
});
