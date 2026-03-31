export type HunkChangeType = 'add' | 'remove' | 'context';
export type HunkStatus = 'pending' | 'accepted' | 'rejected';
export type ViewMode = 'inline' | 'sideBySide';

export interface HunkChange {
  type: HunkChangeType;
  content: string;
}

export interface DiffHunk {
  id: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  changes: HunkChange[];
  status: HunkStatus;
}

export interface DiffFile {
  filePath: string;
  relativePath: string;
  hunks: DiffHunk[];
  isNew: boolean;
  isDeleted: boolean;
}

export interface FileSnapshot {
  filePath: string;
  originalContent: string;
  timestamp: number;
}
