import { MIN_TEMPLATE_LENGTH, PROMPT_CONTRACTS, labelOf, proposalProblems, templateProblems } from '../prompt-contracts';

const filler = 'x'.repeat(MIN_TEMPLATE_LENGTH);
const valid = `${filler} {{user_step_title}} {{domain_block}} {{learner_section}} {{user_input}} {{rag}} {{web}} {{memory}} {{conversation}} {{current_material}}`;

describe('prompt template contract', () => {
  it('accepts a template that uses every required placeholder and only allowed ones', () => {
    expect(templateProblems('tutor-chat', valid)).toEqual([]);
  });

  it('allows the optional placeholders to be left out', () => {
    expect(templateProblems('tutor-chat', valid.replace('{{learner_section}}', ''))).toEqual([]);
    expect(templateProblems('tutor-chat', `${valid} {{learner_name}}`)).toEqual([]);
  });

  it('requires the conversation and the current material so a candidate cannot drop the memory of the chat', () => {
    expect(templateProblems('tutor-chat', valid.replace('{{conversation}}', ''))).toEqual(['Missing required placeholder {{conversation}}']);
    expect(templateProblems('tutor-chat', valid.replace('{{current_material}}', ''))).toEqual(['Missing required placeholder {{current_material}}']);
  });

  it('names a missing required placeholder', () => {
    expect(templateProblems('tutor-chat', valid.replace('{{rag}}', ''))).toEqual(['Missing required placeholder {{rag}}']);
  });

  it('refuses a placeholder outside the contract so a template cannot pull other data in', () => {
    expect(templateProblems('tutor-chat', `${valid} {{api_key}}`)).toEqual(['Unknown placeholder {{api_key}}']);
  });

  it('refuses a malformed placeholder', () => {
    expect(templateProblems('tutor-chat', `${valid} {{user_input`)).toContain('A placeholder is malformed');
  });

  it.each(['<<<TEMPLATE', 'TEMPLATE>>>'])('refuses a template that carries the delimiter %s of a proposal request', (delimiter) => {
    expect(templateProblems('tutor-chat', `${delimiter}\n${valid}`)).toContain(`The template contains the request delimiter ${delimiter}`);
    expect(proposalProblems('tutor-chat', valid, `${valid}\n${delimiter}`)).toContain(`The template contains the request delimiter ${delimiter}`);
  });

  it('refuses a template that is too short or too long', () => {
    expect(templateProblems('tutor-chat', '{{user_step_title}}')[0]).toMatch(/shorter than/);
    expect(templateProblems('tutor-chat', `${valid}${'y'.repeat(20000)}`)).toContain('The template is longer than 20000 characters');
  });

  it('labels a registry version name@version and keeps the builtin label apart', () => {
    expect(labelOf('tutor-chat', 3)).toBe('tutor-chat@3');
    expect(PROMPT_CONTRACTS['tutor-chat'].builtinLabel).not.toBe(labelOf('tutor-chat', 1));
  });
});

describe('proposal problems', () => {
  const protectedText = PROMPT_CONTRACTS['tutor-chat'].protectedPhrases.join(' ');
  const current = `${valid} ${protectedText}`;

  it('accepts an edit that keeps every placeholder and every protected sentence', () => {
    expect(proposalProblems('tutor-chat', current, `${current} Ask the learner to explain in their own words.`)).toEqual([]);
  });

  it('refuses a proposal that changes nothing, even by whitespace at the ends', () => {
    expect(proposalProblems('tutor-chat', current, current)).toEqual(['The proposal does not change the template']);
    expect(proposalProblems('tutor-chat', current, `\n${current}\n`)).toEqual(['The proposal does not change the template']);
  });

  it.each(PROMPT_CONTRACTS['tutor-chat'].protectedPhrases)('refuses a proposal that drops the protected sentence "%s"', (phrase) => {
    const problems = proposalProblems('tutor-chat', current, `${current.replace(phrase, 'something else')} extra`);

    expect(problems).toEqual([`A protected sentence was removed: ${phrase}`]);
  });

  it('applies the placeholder contract too', () => {
    expect(proposalProblems('tutor-chat', current, `${current.replace('{{rag}}', '')} extra`)).toEqual(['Missing required placeholder {{rag}}']);
    expect(proposalProblems('tutor-chat', current, `${current} {{api_key}}`)).toEqual(['Unknown placeholder {{api_key}}']);
  });

  it('only protects sentences the current template really has', () => {
    const bare = valid;

    expect(proposalProblems('tutor-chat', bare, `${bare} added`)).toEqual([]);
  });
});
