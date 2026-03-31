import { structuredPatch } from 'diff';
import { DiffHunk, HunkChange } from './types';

export class DiffComputer {
  computeHunks(originalContent: string, currentContent: string, filePath: string): DiffHunk[] {
    const patch = structuredPatch(
      'original',
      'modified',
      originalContent,
      currentContent,
      '',
      '',
      { context: 3 }
    );

    return patch.hunks.map((hunk, index) => {
      const changes: HunkChange[] = hunk.lines.map(line => {
        let type: HunkChange['type'];
        if (line.startsWith('+')) {
          type = 'add';
        } else if (line.startsWith('-')) {
          type = 'remove';
        } else {
          type = 'context';
        }
        return {
          type,
          content: line.substring(1),
        };
      });

      return {
        id: `${filePath}:hunk:${index}`,
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
        changes,
        status: 'pending' as const,
      };
    });
  }

  getAddedLineRanges(hunk: DiffHunk): { start: number; end: number }[] {
    const ranges: { start: number; end: number }[] = [];
    let currentLine = hunk.newStart;
    let rangeStart = -1;

    for (const change of hunk.changes) {
      if (change.type === 'add') {
        if (rangeStart === -1) {
          rangeStart = currentLine;
        }
        currentLine++;
      } else if (change.type === 'context') {
        if (rangeStart !== -1) {
          ranges.push({ start: rangeStart, end: currentLine - 1 });
          rangeStart = -1;
        }
        currentLine++;
      } else {
        // 'remove' lines don't exist in the new file
        if (rangeStart !== -1) {
          ranges.push({ start: rangeStart, end: currentLine - 1 });
          rangeStart = -1;
        }
      }
    }

    if (rangeStart !== -1) {
      ranges.push({ start: rangeStart, end: currentLine - 1 });
    }

    return ranges;
  }

  getRemovedLines(hunk: DiffHunk): string[] {
    return hunk.changes
      .filter(c => c.type === 'remove')
      .map(c => c.content);
  }

  getOriginalLinesForHunk(hunk: DiffHunk): string[] {
    return hunk.changes
      .filter(c => c.type === 'remove' || c.type === 'context')
      .map(c => c.content);
  }

  getNewLinesForHunk(hunk: DiffHunk): string[] {
    return hunk.changes
      .filter(c => c.type === 'add' || c.type === 'context')
      .map(c => c.content);
  }
}
