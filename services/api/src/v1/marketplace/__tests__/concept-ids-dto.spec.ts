import { CreateArticleDto, UpdateArticleDto } from '../../articles/articles.dto';
import { CreateClassDto, UpdateClassDto } from '../../classes/classes.dto';
import { ConceptIdsDto } from '../marketplace.dto';

const article = { title: 'Memahami jurnal', content: '# Isi' };
const klass = { title: 'Kelas jurnal' };

describe('ConceptIdsDto', () => {
  it('accepts up to five trimmed ids', () => {
    expect(ConceptIdsDto.parse([' l1-t01-accounting-equation ', 'b'])).toEqual(['l1-t01-accounting-equation', 'b']);
    expect(ConceptIdsDto.parse(['a', 'b', 'c', 'd', 'e'])).toHaveLength(5);
    expect(ConceptIdsDto.parse([])).toEqual([]);
  });

  it.each([
    ['six ids', ['a', 'b', 'c', 'd', 'e', 'f']],
    ['an empty id', ['a', '  ']],
    ['an id that is too long', ['x'.repeat(121)]],
    ['a number', [1]],
    ['a string instead of a list', 'a'],
  ])('rejects %s', (_name, value) => {
    expect(ConceptIdsDto.safeParse(value).success).toBe(false);
  });
});

describe('product DTOs with concept ids', () => {
  it('accept the tags on create and leave them out when not sent', () => {
    expect(CreateArticleDto.parse({ ...article, conceptIds: ['a'] }).conceptIds).toEqual(['a']);
    expect(CreateArticleDto.parse(article).conceptIds).toBeUndefined();
    expect(CreateClassDto.parse({ ...klass, conceptIds: ['a', 'b'] }).conceptIds).toEqual(['a', 'b']);
    expect(CreateClassDto.parse(klass).conceptIds).toBeUndefined();
  });

  it('keep an update without tags free of tags, so it cannot clear them by accident', () => {
    expect(UpdateArticleDto.parse({ title: 'Baru' })).toEqual({ title: 'Baru' });
    expect(UpdateClassDto.parse({ title: 'Baru' })).toEqual({ title: 'Baru' });
  });

  it('let an update clear the tags on purpose', () => {
    expect(UpdateArticleDto.parse({ conceptIds: [] }).conceptIds).toEqual([]);
    expect(UpdateClassDto.parse({ conceptIds: [] }).conceptIds).toEqual([]);
  });

  it('reject more than five tags on create and update', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'];

    expect(CreateArticleDto.safeParse({ ...article, conceptIds: six }).success).toBe(false);
    expect(UpdateArticleDto.safeParse({ conceptIds: six }).success).toBe(false);
    expect(CreateClassDto.safeParse({ ...klass, conceptIds: six }).success).toBe(false);
    expect(UpdateClassDto.safeParse({ conceptIds: six }).success).toBe(false);
  });

  it('stay strict about every other field', () => {
    expect(CreateArticleDto.safeParse({ ...article, conceptLinks: [] }).success).toBe(false);
    expect(CreateClassDto.safeParse({ ...klass, status: 'APPROVED' }).success).toBe(false);
  });
});
