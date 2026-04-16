import Dexie, { type Table } from 'dexie';

export interface Artifact {
  id?: number;
  filename: string;
  date: string;
  size: string;
  type: string;
}

export class NightPaperDatabase extends Dexie {
  artifacts!: Table<Artifact>;

  constructor() {
    super('NightPaperDB');
    this.version(1).stores({
      artifacts: '++id, filename, date, size, type'
    });
  }
}

export const db = new NightPaperDatabase();
