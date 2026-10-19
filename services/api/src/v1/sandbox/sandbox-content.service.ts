import { Injectable, Logger } from '@nestjs/common';
import { SandboxGraph, SandboxGraphSchema } from './dto/sandbox.dto';
import { Chart } from './engine';
import { SandboxScenarioDef, ScaledScenario, buildSandboxContent, variantFor, variantsOf } from './sandbox-content';
import { readSeedJson as readJson } from './seed-file';

@Injectable()
export class SandboxContentService {
  readonly chart: Chart;
  private readonly scenarios: SandboxScenarioDef[];
  private readonly graph: SandboxGraph;

  constructor() {
    const content = buildSandboxContent(readJson('sandbox-chart-of-accounts.json'), readJson('sandbox-scenarios.json'));
    this.chart = content.chart;
    this.scenarios = content.scenarios;
    this.graph = this.loadGraph();
  }

  private loadGraph(): SandboxGraph {
    try {
      return SandboxGraphSchema.parse(readJson('golden-accounting-graph.json'));
    } catch (error) {
      new Logger(SandboxContentService.name).warn(`The concept graph could not be read: ${(error as Error).message}`);
      return { levels: [] };
    }
  }

  list(filter: { level?: number; conceptId?: string; difficulty?: string; tag?: string } = {}): SandboxScenarioDef[] {
    return this.scenarios.filter(
      (scenario) =>
        (filter.level === undefined || scenario.level === filter.level) &&
        (filter.conceptId === undefined || scenario.conceptId === filter.conceptId) &&
        (filter.difficulty === undefined || scenario.difficulty === filter.difficulty) &&
        (filter.tag === undefined || scenario.tags.includes(filter.tag)),
    );
  }

  find(id: string): SandboxScenarioDef | undefined {
    return this.scenarios.find((scenario) => scenario.id === id);
  }

  variant(scenario: SandboxScenarioDef, seed: number): ScaledScenario | null {
    return variantFor(scenario, seed);
  }

  variantCount(scenario: SandboxScenarioDef): number {
    return variantsOf(scenario).length;
  }

  conceptIds(): string[] {
    return Array.from(new Set(this.scenarios.map((scenario) => scenario.conceptId)));
  }

  getGraph(): SandboxGraph {
    return this.graph;
  }
}
