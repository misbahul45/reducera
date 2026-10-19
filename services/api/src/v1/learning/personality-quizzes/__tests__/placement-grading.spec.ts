import { gradePlacement, placementForViewer } from '../placement-grading';

const questions = [
  { question: 'Mana yang akun aset?', answer: 'Kas' },
  { question: 'Mana yang akun kewajiban?', answer: 'Utang usaha' },
  { question: 'Mana yang akun modal?', answer: 'Modal pemilik' },
  { question: 'Mana yang akun beban?', answer: 'Beban gaji' },
];

const answersFor = (given: string[]) => questions.map((item, index) => ({ question: item.question, userAnswer: given[index] }));

describe('gradePlacement', () => {
  it('grades from the stored answer key', () => {
    const grade = gradePlacement(questions, answersFor(['Kas', 'Utang usaha', 'Modal pemilik', 'Beban gaji']));

    expect(grade.result.level).toBe('expert');
    expect(grade.result.scores).toEqual({ Kas: 10, 'Utang usaha': 10, 'Modal pemilik': 10, 'Beban gaji': 10 });
  });

  it('puts the stored key, not a client key, on the saved attempt', () => {
    const grade = gradePlacement(questions, answersFor(['Salah', 'Utang usaha', 'Modal pemilik', 'Beban gaji']));

    expect(grade.attempt[0]).toEqual({ question: 'Mana yang akun aset?', userAnswer: 'Salah', answer: 'Kas' });
  });

  it('keeps a wrong answer in the scores with zero points', () => {
    const grade = gradePlacement(questions, answersFor(['Salah', 'Utang usaha', 'Modal pemilik', 'Beban gaji']));

    expect(grade.result.scores.Kas).toBe(0);
    expect(grade.result.level).toBe('advanced');
  });

  it.each([
    [['Salah', 'Salah', 'Salah', 'Salah'], 'beginner'],
    [['Kas', 'Salah', 'Salah', 'Salah'], 'beginner'],
    [['Kas', 'Utang usaha', 'Salah', 'Salah'], 'beginner'],
    [['Kas', 'Utang usaha', 'Modal pemilik', 'Salah'], 'advanced'],
  ])('maps %j to %s', (given, level) => {
    expect(gradePlacement(questions, answersFor(given)).result.level).toBe(level);
  });

  it('ignores spaces around an answer', () => {
    const grade = gradePlacement(questions, answersFor(['  Kas ', 'Utang usaha', 'Modal pemilik', 'Beban gaji']));

    expect(grade.result.scores.Kas).toBe(10);
  });

  it('never turns an empty attempt into the best level', () => {
    expect(() => gradePlacement(questions, [])).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects a quiz without questions instead of dividing by zero', () => {
    expect(() => gradePlacement([], [])).toThrow(expect.objectContaining({ statusCode: 422 }));
  });

  it('rejects a question that was left out', () => {
    expect(() => gradePlacement(questions, answersFor(['Kas', 'Utang usaha', 'Modal pemilik', 'Beban gaji']).slice(0, 3))).toThrow(
      expect.objectContaining({ statusCode: 400 }),
    );
  });

  it('rejects a question answered twice', () => {
    const twice = [...answersFor(['Kas', 'Utang usaha', 'Modal pemilik', 'Beban gaji']), { question: 'Mana yang akun aset?', userAnswer: 'Kas' }];

    expect(() => gradePlacement(questions, twice)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('rejects an answer to a question the quiz does not have', () => {
    const foreign = [...answersFor(['Kas', 'Utang usaha', 'Modal pemilik', 'Beban gaji']), { question: 'Pertanyaan asing', userAnswer: 'x' }];

    expect(() => gradePlacement(questions, foreign)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('counts a question without a key in the total but not in the scores', () => {
    const open = [...questions, { question: 'Jelaskan jurnal penyesuaian', answer: null }];
    const grade = gradePlacement(open, [...answersFor(['Kas', 'Utang usaha', 'Modal pemilik', 'Beban gaji']), { question: 'Jelaskan jurnal penyesuaian', userAnswer: 'apa saja' }]);

    expect(Object.keys(grade.result.scores)).toHaveLength(4);
    expect(grade.result.level).toBe('advanced');
    expect(grade.attempt[4]).toEqual({ question: 'Jelaskan jurnal penyesuaian', userAnswer: 'apa saja', answer: null });
  });
});

describe('placementForViewer', () => {
  const quiz = {
    id: 'pq-1',
    questions: [{ question: 'Q', options: ['a', 'b'], answer: 'a', sources: [1] }],
    userAttempt: [{ question: 'Q', userAnswer: 'a', answer: 'a' }],
    result: { level: 'expert', scores: { a: 10 } },
  };

  it('removes the key from questions and the saved attempt for a learner', () => {
    const view = placementForViewer('STUDENT', quiz);

    expect(view.questions[0]).toEqual({ question: 'Q', options: ['a', 'b'], sources: [1] });
    expect(view.userAttempt?.[0]).toEqual({ question: 'Q', userAnswer: 'a' });
    expect(view.result).toEqual(quiz.result);
  });

  it('also hides it from a teacher, who does not author these quizzes', () => {
    expect(placementForViewer('TEACHER', quiz).questions[0]).not.toHaveProperty('answer');
  });

  it('keeps it for an administrator', () => {
    expect(placementForViewer('ADMIN', quiz)).toBe(quiz);
  });

  it('does not change the object it was given', () => {
    placementForViewer('STUDENT', quiz);

    expect(quiz.questions[0].answer).toBe('a');
  });

  it('passes a row without questions through', () => {
    expect(placementForViewer('STUDENT', { id: 'x' })).toEqual({ id: 'x' });
    expect(placementForViewer('STUDENT', null)).toBeNull();
  });

  it('copes with a JSON null attempt', () => {
    expect(placementForViewer('STUDENT', { ...quiz, userAttempt: null }).userAttempt).toBeNull();
  });
});
