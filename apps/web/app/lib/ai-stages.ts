export type StageState = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

export type FactTone = 'ok' | 'muted' | 'warn';

export interface AiFact {
  key: string;
  text: string;
  tone: FactTone;
}

export interface AiStage {
  key: string;
  label: string;
  state: StageState;
  detail: string;
  fact: AiFact | null;
}

export interface StageEvent {
  key: string;
  state: StageState;
  data: Record<string, unknown>;
}

const STATES: ReadonlyArray<StageState> = ['pending', 'active', 'done', 'skipped', 'failed'];

const STYLE_LABELS: Readonly<Record<string, string>> = {
  visual: 'Visual',
  auditory: 'Auditori',
  reading_writing: 'Membaca & menulis',
  kinesthetic: 'Praktik langsung',
};

export const introStages = (): AiStage[] => [
  { key: 'context', label: 'Membaca langkah pelajaran', state: 'active', detail: '', fact: null },
  { key: 'profile', label: 'Mencocokkan gaya belajarmu', state: 'pending', detail: '', fact: null },
  { key: 'retrieval', label: 'Mencari sumber pendukung', state: 'pending', detail: '', fact: null },
  { key: 'writing', label: 'Menulis pengantar', state: 'pending', detail: '', fact: null },
];

export const parseStageEvent = (raw: string): StageEvent | null => {
  try {
    const value = JSON.parse(raw) as Partial<StageEvent> | null;
    if (!value || typeof value.key !== 'string' || !STATES.includes(value.state as StageState)) return null;
    const data = value.data && typeof value.data === 'object' ? (value.data as Record<string, unknown>) : {};
    return { key: value.key, state: value.state as StageState, data };
  } catch {
    return null;
  }
};

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

const titlesOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((title): title is string => typeof title === 'string' && title.trim().length > 0) : [];

export const describeStage = (event: StageEvent): { detail: string; fact: AiFact | null } => {
  const { key, state, data } = event;

  if (key === 'context') {
    const steps = count(data.steps);
    const titles = titlesOf(data.titles);
    const names = titles.length ? `: ${titles.join(', ')}${steps > titles.length ? ', dan lainnya' : ''}` : '';
    return { detail: `${steps} langkah pelajaran dibaca${names}`, fact: { key, text: `${steps} langkah pelajaran dibaca`, tone: 'ok' } };
  }

  if (key === 'profile') {
    const label = typeof data.style === 'string' ? STYLE_LABELS[data.style] : undefined;
    if (state === 'done' && label) {
      return { detail: `Gaya belajar yang paling cocok denganmu: ${label}`, fact: { key, text: `Gaya belajar: ${label}`, tone: 'ok' } };
    }
    return {
      detail: 'Gaya belajarmu belum diketahui, jadi pengantar ditulis dengan gaya umum',
      fact: { key, text: 'Gaya belajar umum', tone: 'muted' },
    };
  }

  if (key === 'retrieval') {
    const sources = count(data.sources);
    const topic = count(data.topic);
    const queries = count(data.queries);
    if (state === 'failed' && topic > 0) {
      return {
        detail: `${topic} sumber dari materi course ditemukan. Pencarian berdasarkan arti sedang tidak aktif, jadi sumber yang muncul bisa lebih sedikit`,
        fact: { key, text: `${topic} sumber, pencarian terbatas`, tone: 'warn' },
      };
    }
    if (state === 'failed') {
      return {
        detail: 'Sumber tambahan belum bisa diambil, jadi pengantar hanya memakai isi langkah pelajaran',
        fact: { key, text: 'Sumber belum bisa diambil', tone: 'warn' },
      };
    }
    if (state === 'skipped' && topic === 0) {
      return { detail: 'Pencarian sumber tambahan dilewati', fact: { key, text: 'Tanpa sumber tambahan', tone: 'muted' } };
    }
    if (topic > 0 || sources > 0) {
      const parts = [topic > 0 ? `${topic} sumber dari materi course` : '', sources > 0 ? `${sources} cuplikan dari ${queries} pencarian` : ''];
      return {
        detail: parts.filter(Boolean).join(' dan ') + ' ditemukan',
        fact: { key, text: `${topic + sources} sumber ditemukan`, tone: 'ok' },
      };
    }
    return {
      detail: 'Belum ada sumber materi untuk pelajaran ini, jadi pengantar hanya memakai isi langkah pelajaran',
      fact: { key, text: 'Belum ada sumber materi', tone: 'muted' },
    };
  }

  if (key === 'writing') {
    return { detail: 'Menulis hanya dari sumber di atas. Setiap pernyataan diberi nomor sumber', fact: null };
  }

  return { detail: '', fact: null };
};

const FINISHED: ReadonlyArray<StageState> = ['done', 'skipped', 'failed'];

export const applyStageEvent = (stages: AiStage[], event: StageEvent): AiStage[] => {
  const index = stages.findIndex((stage) => stage.key === event.key);
  if (index === -1) return stages;

  const described = describeStage(event);
  const next = stages.map((stage, position) => {
    if (position === index) {
      return { ...stage, state: event.state, detail: described.detail, fact: described.fact };
    }
    if (position < index && !FINISHED.includes(stage.state)) return { ...stage, state: 'done' as StageState };
    return stage;
  });

  if (FINISHED.includes(event.state) && !next.some((stage) => stage.state === 'active')) {
    const following = next.findIndex((stage, position) => position > index && stage.state === 'pending');
    if (following !== -1) next[following] = { ...next[following]!, state: 'active' };
  }
  return next;
};

export const factsOf = (stages: AiStage[]): AiFact[] => stages.flatMap((stage) => (stage.fact ? [stage.fact] : []));

export const hasFailed = (stages: AiStage[]): boolean => stages.some((stage) => stage.state === 'failed');

export const FAILED_HEADLINE = 'Ada tahap yang belum berhasil';

export const headlineOf = (stages: AiStage[], busy: boolean, title: string, doneTitle: string): string => {
  if (busy) return title;
  if (hasFailed(stages)) return FAILED_HEADLINE;
  return doneTitle || title;
};

export const settledLive = (stages: AiStage[]): string => (hasFailed(stages) ? FAILED_HEADLINE : 'Semua tahap selesai');

export const currentStage = (stages: AiStage[]): AiStage | null =>
  stages.find((stage) => stage.state === 'active') ?? [...stages].reverse().find((stage) => FINISHED.includes(stage.state)) ?? null;

export interface StagePacer {
  push: (event: StageEvent) => void;
  flush: () => void;
  stop: () => void;
}

export const createStagePacer = (
  apply: (event: StageEvent) => void,
  gapMs: number,
  timers: { set: (run: () => void, ms: number) => unknown; clear: (handle: unknown) => void } = {
    set: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): StagePacer => {
  const queue: StageEvent[] = [];
  let handle: unknown = null;

  const drain = () => {
    handle = null;
    const event = queue.shift();
    if (!event) return;
    apply(event);
    handle = timers.set(drain, gapMs);
  };

  return {
    push(event) {
      queue.push(event);
      if (handle === null) drain();
    },
    flush() {
      if (handle !== null) timers.clear(handle);
      handle = null;
      while (queue.length) apply(queue.shift()!);
    },
    stop() {
      if (handle !== null) timers.clear(handle);
      handle = null;
      queue.length = 0;
    },
  };
};
