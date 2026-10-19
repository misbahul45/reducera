import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { arcjetKeyFrom } from '../arcjet';

const SRC = join(__dirname, '..', '..', '..');
const REPO = join(SRC, '..', '..', '..');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });

describe('arcjetKeyFrom', () => {
  it('reads ARCJET_KEY, the name that compose and .env.example define', () => {
    expect(arcjetKeyFrom({ ARCJET_KEY: 'ajkey_value' })).toBe('ajkey_value');
  });

  it('trims the value', () => {
    expect(arcjetKeyFrom({ ARCJET_KEY: '  ajkey_value\n' })).toBe('ajkey_value');
  });

  it.each([[{}], [{ ARCJET_KEY: '' }], [{ ARCJET_KEY: '   ' }]])('answers undefined for %j so the caller can warn', (env) => {
    expect(arcjetKeyFrom(env)).toBeUndefined();
  });

  it('ignores the old name that nothing sets', () => {
    expect(arcjetKeyFrom({ ARCJET_API_KEY: 'ajkey_old' })).toBeUndefined();
  });
});

describe('the variable name of the Arcjet key', () => {
  it('is not spelled the old way anywhere in the API source', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !file.includes(`${join('common', 'config', '__tests__')}`))
      .filter((file) => readFileSync(file, 'utf8').includes('ARCJET_API_KEY'));

    expect(offenders).toEqual([]);
  });

  it.each(['docker-compose.yml', 'docker-compose.prod.yml'])('is passed to the api by %s under the name the code reads', (file) => {
    const compose = readFileSync(join(REPO, file), 'utf8');

    expect(compose).toMatch(/^\s+ARCJET_KEY: \$\{ARCJET_KEY\}$/m);
  });
});
