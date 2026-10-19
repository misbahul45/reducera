import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const boards = join(__dirname, '..');
const source = (file: string): string => readFileSync(join(boards, file), 'utf8');

describe('what the leaderboard module shows', () => {
  it('has no controller that lists score rows or reads one by id', () => {
    expect(existsSync(join(boards, 'leaderboards.controller.ts'))).toBe(false);
    expect(existsSync(join(boards, 'leaderboards.service.ts'))).toBe(false);
  });

  it('registers only the opt-in topic board controller', () => {
    const module = source('leaderboards.module.ts');

    expect(module).toMatch(/controllers:\s*\[TopicBoardController\]/);
    expect(module).not.toContain('LeaderboardsController');
    expect(module).not.toContain('LeaderboardsService');
  });

  it('keeps the repository to writes, so no route can read score rows together with their users', () => {
    const repo = source('leaderboards.repo.ts');

    expect(repo).not.toMatch(/async findAll\(/);
    expect(repo).not.toMatch(/async findOne\(/);
    expect(repo).not.toMatch(/user:\s*true/);
  });

  it('serves the topic board and the membership route and nothing else', () => {
    const controller = source('topic-board.controller.ts');
    const routes = [...controller.matchAll(/@(Get|Put|Post|Patch|Delete)\('([^']*)'\)/g)].map((match) => `${match[1]} ${match[2]}`);

    expect(routes.sort()).toEqual(['Get topics/:topicId', 'Put me']);
  });
});
