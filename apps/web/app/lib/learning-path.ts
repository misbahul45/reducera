import { plainText } from '~/lib/topics';

export type PathNodeState = 'done' | 'current' | 'available' | 'locked';

export interface PathSubTopic {
  id: string;
  title?: string | null;
  description?: string | null;
  sortOrder?: number;
  isUnlocked?: boolean;
  progress?: { status?: string | null } | null;
  _count?: { lessons?: number } | null;
}

export interface PathNode {
  id: string;
  title: string;
  summary: string;
  state: PathNodeState;
  lessons: number;
  to: string | null;
  unit?: string;
  unitDone?: number;
  unitTotal?: number;
  active?: boolean;
}

export interface PathStep {
  id: string;
  title?: string | null;
  order?: number;
  isDone?: boolean;
  isUnlocked?: boolean;
}

export interface PathStepGroup {
  id: string;
  title?: string | null;
  sortOrder?: number;
  steps: ReadonlyArray<PathStep>;
}

export interface StepPathOptions {
  lessonId?: string | null;
  activeId?: string | null;
}

const WAVE = [0, 1, 2, 1, 0, -1, -2, -1] as const;

export const pathOffset = (index: number): number => {
  if (!Number.isInteger(index) || index < 0) return 0;
  return WAVE[index % WAVE.length] as number;
};

export const buildPathNodes = (subTopics: ReadonlyArray<PathSubTopic> | null | undefined): PathNode[] => {
  const ordered = [...(subTopics ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  let currentAssigned = false;

  return ordered.map((subTopic) => {
    const done = subTopic.progress?.status === 'COMPLETED';
    const unlocked = subTopic.isUnlocked !== false;
    let state: PathNodeState = 'available';

    if (!unlocked && !done) {
      state = 'locked';
    } else if (done) {
      state = 'done';
    } else if (!currentAssigned) {
      state = 'current';
      currentAssigned = true;
    }

    return {
      id: subTopic.id,
      title: subTopic.title?.trim() || 'Tanpa judul',
      summary: plainText(subTopic.description, 140),
      state,
      lessons: subTopic._count?.lessons ?? 0,
      to: state === 'locked' ? null : `/my-learning/sub-topics/${subTopic.id}`,
    };
  });
};

export const pathSummary = (nodes: ReadonlyArray<PathNode>): { total: number; done: number; percent: number } => {
  const total = nodes.length;
  const done = nodes.filter((node) => node.state === 'done').length;
  return { total, done, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
};

const UNTITLED = 'Tanpa judul';

export const stepHref = (groupId: string, stepId: string, lessonId?: string | null): string =>
  `/my-learning/steps/${groupId}/${stepId}${lessonId ? `?lessonId=${encodeURIComponent(lessonId)}` : ''}`;

export const buildStepPath = (groups: ReadonlyArray<PathStepGroup> | null | undefined, options: StepPathOptions = {}): PathNode[] => {
  const ordered = [...(groups ?? [])]
    .map((group, index) => ({ group, index }))
    .sort((a, b) => (a.group.sortOrder ?? 0) - (b.group.sortOrder ?? 0) || a.index - b.index)
    .map(({ group }) => group);

  let currentAssigned = false;
  const nodes: PathNode[] = [];

  for (const group of ordered) {
    const steps = [...group.steps]
      .map((step, index) => ({ step, index }))
      .sort((a, b) => (a.step.order ?? 0) - (b.step.order ?? 0) || a.index - b.index)
      .map(({ step }) => step);
    if (steps.length === 0) continue;

    const unit = group.title?.trim() || UNTITLED;
    const unitDone = steps.filter((step) => step.isDone === true).length;

    for (const step of steps) {
      const done = step.isDone === true;
      const unlocked = step.isUnlocked === true;
      let state: PathNodeState = 'available';

      if (done) {
        state = 'done';
      } else if (!unlocked) {
        state = 'locked';
      } else if (!currentAssigned) {
        state = 'current';
        currentAssigned = true;
      }

      nodes.push({
        id: step.id,
        title: step.title?.trim() || UNTITLED,
        summary: '',
        state,
        lessons: 0,
        to: state === 'locked' ? null : stepHref(group.id, step.id, options.lessonId),
        unit,
        unitDone,
        unitTotal: steps.length,
        active: options.activeId === step.id,
      });
    }
  }

  return nodes;
};
