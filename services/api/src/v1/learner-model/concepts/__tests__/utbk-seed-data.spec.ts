import * as fs from 'fs';
import * as path from 'path';
import { parseAliases, parseGoldenGraph, parseLinks, validateConceptSeed } from '../concept-seed';

const seedDir = path.resolve(__dirname, '../../../../../prisma/seed-data');
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(seedDir, name), 'utf8'));

interface Step {
  title: string;
  description: string;
}
interface Lesson {
  title: string;
  description: string;
  steps: Step[];
}
interface SubTopic {
  slug: string;
  title: string;
  description: string;
  prerequisites: string[];
  lessons: Lesson[];
}
interface Topic {
  slug: string;
  title: string;
  category: string;
  description: string;
  durationMinutes: number;
  subTopics: SubTopic[];
}

const topic: Topic = read('utbk-snbt.topic.json');
const pack = read('utbk-snbt.concepts.json') as { graph: unknown; links: unknown };
const graph = parseGoldenGraph(pack.graph);
const links = parseLinks(pack.links);
const accounting = parseGoldenGraph(read('golden-accounting-graph.json'));

const OFFICIAL_SUBTESTS = [
  'Penalaran Umum',
  'Pengetahuan dan Pemahaman Umum',
  'Pemahaman Bacaan dan Menulis',
  'Pengetahuan Kuantitatif',
  'Literasi dalam Bahasa Indonesia',
  'Literasi dalam Bahasa Inggris',
  'Penalaran Matematika',
];

const allText = () => JSON.stringify(topic);

describe('UTBK-SNBT topic file', () => {
  it('has one sub-topic for each of the seven official subtests and one to get to know the test', () => {
    const titles = topic.subTopics.map((sub) => sub.title);
    for (const subtest of OFFICIAL_SUBTESTS) expect(titles).toContain(subtest);
    expect(topic.subTopics).toHaveLength(OFFICIAL_SUBTESTS.length + 1);
    expect(titles[0]).toBe('Mengenal UTBK-SNBT');
  });

  it('is a topic the seeder accepts: unique slugs, known prerequisites, no cycle, every lesson has steps', () => {
    const slugs = topic.subTopics.map((sub) => sub.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const sub of topic.subTopics) {
      for (const required of sub.prerequisites) expect(slugs).toContain(required);
      expect(sub.prerequisites).not.toContain(sub.slug);
      expect(sub.lessons.length).toBeGreaterThan(0);
      for (const lesson of sub.lessons) expect(lesson.steps.length).toBeGreaterThan(0);
    }
    const requires = new Map(topic.subTopics.map((sub) => [sub.slug, sub.prerequisites]));
    const walk = (slug: string, seen: string[]): void => {
      expect(seen).not.toContain(slug);
      for (const next of requires.get(slug) ?? []) walk(next, [...seen, slug]);
    };
    for (const slug of slugs) walk(slug, []);
  });

  it('gives every step real content a learner and the tutor can ground an answer in', () => {
    for (const sub of topic.subTopics) {
      for (const lesson of sub.lessons) {
        for (const step of lesson.steps) {
          expect(step.title.length).toBeGreaterThan(5);
          expect(step.description.length).toBeGreaterThan(200);
        }
      }
    }
  });

  it('states the official numbers of the 2026 framework exactly', () => {
    const text = allText();
    for (const fact of ['30 soal dalam 30 menit', '20 soal dalam 15 menit', '20 soal dalam 25 menit', '20 soal dalam 20 menit', '90 soal dalam 90 menit', '30 soal dalam 42,5 menit', '70 soal dalam 105 menit', '160 soal dalam 195 menit']) {
      expect(text).toContain(fact);
    }
    expect(text).toContain('20 soal dalam 42,5 menit');
  });

  it('points the learner to the official source and names the spelling guideline', () => {
    const text = allText();
    expect(text).toContain('snpmb.id');
    expect(text).toContain('Ejaan yang Disempurnakan (EYD) Edisi V (2022)');
  });

  it('writes the baku forms it teaches next to the forms to avoid', () => {
    const ejaan = topic.subTopics.flatMap((sub) => sub.lessons).flatMap((lesson) => lesson.steps).find((step) => step.title.startsWith('Ejaan dan kata serapan'));
    expect(ejaan).toBeDefined();
    for (const pair of ['aktivitas (bukan aktifitas)', 'analisis (bukan analisa)', 'risiko (bukan resiko)', 'praktik (bukan praktek)', 'izin (bukan ijin)', 'silakan (bukan silahkan)', 'sekadar (bukan sekedar)']) {
      expect(ejaan!.description).toContain(pair);
    }
  });

  it('respects the product copy rules: no banned term of the web copy guard', () => {
    const text = allText();
    for (const term of ['SMK', 'BNSP', 'SKKNI', 'sertifikasi', 'siswa', 'Menjadi Guru', 'sertifikat kompetensi']) expect(text).not.toContain(term);
  });

  it('uses no placeholder text and no unfinished markers', () => {
    expect(allText()).not.toMatch(/lorem|todo|tbd|xxx|\?\?/i);
  });
});

describe('UTBK-SNBT concepts and curriculum links', () => {
  const issues = () =>
    validateConceptSeed({
      graph: { levels: [...accounting.levels, ...graph.levels] },
      aliases: parseAliases(read('concept-aliases.json')),
      links: parseLinks(read('concept-curriculum-links.json')),
      extraLinks: [links],
    });

  it('keeps the whole registry consistent together with the accounting concepts', () => {
    expect(issues()).toEqual([]);
  });

  it('adds concepts with their own ids and none that collide with the accounting graph', () => {
    const accountingIds = new Set(accounting.levels.flatMap((level) => level.topics.map((item) => item.id)));
    const ids = graph.levels.flatMap((level) => level.topics.map((item) => item.id));
    expect(ids.length).toBeGreaterThanOrEqual(OFFICIAL_SUBTESTS.length);
    for (const id of ids) {
      expect(id.startsWith('utbk-')).toBe(true);
      expect(accountingIds.has(id)).toBe(false);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('links each sub-topic and each lesson of the topic file by its exact title, and nothing else', () => {
    expect(links.topicSlug).toBe(topic.slug);
    expect(links.subTopics.map((link) => link.title).sort()).toEqual(topic.subTopics.map((sub) => sub.title).sort());
    const lessons = topic.subTopics.flatMap((sub) => sub.lessons.map((lesson) => `${sub.title} / ${lesson.title}`));
    expect(links.lessons.map((link) => `${link.subTopicTitle} / ${link.title}`).sort()).toEqual(lessons.sort());
  });

  it('makes a sub-topic link cover exactly the concepts of its lessons', () => {
    for (const sub of links.subTopics) {
      const fromLessons = new Set(links.lessons.filter((lesson) => lesson.subTopicTitle === sub.title).flatMap((lesson) => lesson.conceptIds));
      expect(new Set(sub.conceptIds)).toEqual(fromLessons);
    }
  });

  it('needs the geometry and algebra concept before the mathematical reasoning concept', () => {
    const requires = new Map(graph.levels.flatMap((level) => level.topics.map((item) => [item.id, item.prerequisites] as const)));
    expect(requires.get('utbk-pm-merumuskan')).toContain('utbk-pk-bilangan-aljabar');
    expect(requires.get('utbk-pm-menggunakan-menafsirkan')).toContain('utbk-pm-merumuskan');
  });
});
