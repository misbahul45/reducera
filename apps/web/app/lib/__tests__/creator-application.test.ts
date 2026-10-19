import { describe, expect, it } from 'vitest';
import { applicationPayload, applicationProblem, applicationStage, eligibilityCopy, eligibleTopics, type TopicEligibility } from '~/lib/creator-application';

const form = { fullName: 'Rina Kreator', bio: '', expertise: '', portfolioUrl: '', cvUrl: '', expertiseTopicId: 'topic-1' };

describe('applicationProblem', () => {
  it('needs a topic the learner has mastered', () => {
    expect(applicationProblem({ ...form, expertiseTopicId: '' })).toContain('course');
  });

  it('needs only a name and a topic and accepts empty optional fields', () => {
    expect(applicationProblem(form)).toBeNull();
  });

  it('names what is wrong', () => {
    expect(applicationProblem({ ...form, fullName: ' a ' })).toContain('Nama');
    expect(applicationProblem({ ...form, bio: 'x'.repeat(5001) })).toContain('Bio');
    expect(applicationProblem({ ...form, expertise: 'x'.repeat(1001) })).toContain('keahlian');
    expect(applicationProblem({ ...form, portfolioUrl: 'javascript:alert(1)' })).toContain('portofolio');
    expect(applicationProblem({ ...form, cvUrl: 'ftp://x' })).toContain('CV');
  });

  it('accepts https and http links', () => {
    expect(applicationProblem({ ...form, portfolioUrl: 'https://rina.example/karya', cvUrl: 'http://rina.example/cv.pdf' })).toBeNull();
  });
});

describe('applicationPayload', () => {
  it('trims and leaves empty optional fields out so the strict API accepts it', () => {
    expect(applicationPayload({ ...form, fullName: '  Rina  ', bio: ' Akuntan ' })).toEqual({ expertiseTopicId: 'topic-1', fullName: 'Rina', bio: 'Akuntan' });
  });
});

describe('applicationStage', () => {
  it('maps the API status to a stage and treats no application as none', () => {
    expect(applicationStage(null)).toBe('none');
    expect(applicationStage({ status: 'PENDING' })).toBe('pending');
    expect(applicationStage({ status: 'APPROVED' })).toBe('approved');
    expect(applicationStage({ status: 'REJECTED' })).toBe('rejected');
  });
});

const row = (over: Partial<TopicEligibility> = {}): TopicEligibility => ({
  topicId: 't1',
  title: 'Akuntansi Dasar',
  eligible: false,
  score: 0.72,
  passedConcepts: 3,
  totalConcepts: 5,
  ...over,
});

describe('eligibilityCopy', () => {
  it('says how far the learner is and what the requirement is', () => {
    expect(eligibilityCopy(row())).toBe('3 dari 5 konsep lulus, rata-rata 72%. Syaratnya semua konsep lulus dengan rata-rata 85%.');
  });

  it('confirms when the requirement is met', () => {
    expect(eligibilityCopy(row({ eligible: true, score: 0.9, passedConcepts: 5 }))).toBe('5 dari 5 konsep lulus, rata-rata 90%. Syarat terpenuhi.');
  });

  it('handles a topic without concepts and a learner without a score', () => {
    expect(eligibilityCopy(row({ totalConcepts: 0, passedConcepts: 0, score: null }))).toMatch(/belum punya konsep/);
    expect(eligibilityCopy(row({ score: null, passedConcepts: 0 }))).toContain('rata-rata 0%');
  });
});

describe('eligibleTopics', () => {
  it('keeps only topics that meet the requirement', () => {
    expect(eligibleTopics([row({ topicId: 'a', eligible: true }), row({ topicId: 'b' })]).map((item) => item.topicId)).toEqual(['a']);
  });
});
