import { Injectable } from '@nestjs/common';
import { readSeedJson } from '../seed-file';
import { SqlContent, SqlDataset, SqlExercise, buildSqlContent } from './sql-content';

@Injectable()
export class SqlContentService {
  private readonly content: SqlContent;

  constructor() {
    this.content = buildSqlContent(readSeedJson('sandbox-sql.json'));
  }

  datasets(): SqlDataset[] {
    return this.content.datasets;
  }

  dataset(id: string): SqlDataset | undefined {
    return this.content.datasets.find((dataset) => dataset.id === id);
  }

  exercises(): SqlExercise[] {
    return this.content.exercises;
  }

  exercise(id: string): SqlExercise | undefined {
    return this.content.exercises.find((exercise) => exercise.id === id);
  }
}
