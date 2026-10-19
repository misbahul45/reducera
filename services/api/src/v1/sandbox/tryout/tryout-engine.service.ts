import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { readSeedJson } from '../seed-file';
import { buildTryoutBank } from './tryout-bank';
import { TryoutEngine } from './tryout-engine';

const ConceptGraphSchema = z.object({
  graph: z.object({
    levels: z.array(z.object({ topics: z.array(z.object({ id: z.string(), title: z.string() })) })),
  }),
});

@Injectable()
export class TryoutEngineService {
  readonly engine: TryoutEngine;
  readonly conceptTitles: Record<string, string>;

  constructor() {
    this.engine = new TryoutEngine(buildTryoutBank(readSeedJson('tryout-utbk-bank.json')));
    const graph = ConceptGraphSchema.parse(readSeedJson('utbk-snbt.concepts.json'));
    this.conceptTitles = Object.fromEntries(graph.graph.levels.flatMap((level) => level.topics.map((topic) => [topic.id, topic.title])));
  }
}
