const GRID_EPSILON = 1e-9;
const GRID_KEY_OFFSET = 32_768;
const GRID_KEY_STRIDE = 65_536;

export interface StaticGridBounds {
  minimumX: number;
  maximumX: number;
  minimumZ: number;
  maximumZ: number;
}

export class StaticGridIndex<T> {
  private readonly cells = new Map<number, number[]>();
  private readonly visited: Uint32Array;
  private readonly candidateIndices: number[] = [];
  private readonly candidates: T[] = [];
  private generation = 0;

  public constructor(
    private readonly items: readonly T[],
    private readonly cellSize: number,
    boundsFor: (item: T) => StaticGridBounds,
  ) {
    this.visited = new Uint32Array(items.length);
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item) continue;
      const bounds = boundsFor(item);
      const minimumCellX = this.cell(bounds.minimumX - GRID_EPSILON);
      const maximumCellX = this.cell(bounds.maximumX + GRID_EPSILON);
      const minimumCellZ = this.cell(bounds.minimumZ - GRID_EPSILON);
      const maximumCellZ = this.cell(bounds.maximumZ + GRID_EPSILON);
      for (let cellX = minimumCellX; cellX <= maximumCellX; cellX += 1) {
        for (let cellZ = minimumCellZ; cellZ <= maximumCellZ; cellZ += 1) {
          const key = gridKey(cellX, cellZ);
          const entries = this.cells.get(key);
          if (entries) entries.push(index);
          else this.cells.set(key, [index]);
        }
      }
    }
  }

  public queryPoint(x: number, z: number): readonly T[] {
    this.beginQuery();
    this.addCell(this.cell(x), this.cell(z));
    return this.finishQuery();
  }

  public querySegment(startX: number, startZ: number, endX: number, endZ: number): readonly T[] {
    this.beginQuery();
    let cellX = this.cell(startX);
    let cellZ = this.cell(startZ);
    const endCellX = this.cell(endX);
    const endCellZ = this.cell(endZ);
    const deltaX = endX - startX;
    const deltaZ = endZ - startZ;
    const stepX = deltaX > 0 ? 1 : deltaX < 0 ? -1 : 0;
    const stepZ = deltaZ > 0 ? 1 : deltaZ < 0 ? -1 : 0;
    const timeDeltaX = stepX === 0 ? Number.POSITIVE_INFINITY : Math.abs(this.cellSize / deltaX);
    const timeDeltaZ = stepZ === 0 ? Number.POSITIVE_INFINITY : Math.abs(this.cellSize / deltaZ);
    const boundaryX = stepX > 0 ? (cellX + 1) * this.cellSize : cellX * this.cellSize;
    const boundaryZ = stepZ > 0 ? (cellZ + 1) * this.cellSize : cellZ * this.cellSize;
    let nextTimeX = stepX === 0 ? Number.POSITIVE_INFINITY : (boundaryX - startX) / deltaX;
    let nextTimeZ = stepZ === 0 ? Number.POSITIVE_INFINITY : (boundaryZ - startZ) / deltaZ;
    const maximumCells = Math.abs(endCellX - cellX) + Math.abs(endCellZ - cellZ) + 3;

    for (let visitedCells = 0; visitedCells < maximumCells; visitedCells += 1) {
      this.addCell(cellX, cellZ);
      if (cellX === endCellX && cellZ === endCellZ) break;
      if (Math.abs(nextTimeX - nextTimeZ) <= GRID_EPSILON) {
        this.addCell(cellX + stepX, cellZ);
        this.addCell(cellX, cellZ + stepZ);
        cellX += stepX;
        cellZ += stepZ;
        nextTimeX += timeDeltaX;
        nextTimeZ += timeDeltaZ;
      } else if (nextTimeX < nextTimeZ) {
        cellX += stepX;
        nextTimeX += timeDeltaX;
      } else {
        cellZ += stepZ;
        nextTimeZ += timeDeltaZ;
      }
    }
    return this.finishQuery();
  }

  private beginQuery(): void {
    this.generation = (this.generation + 1) >>> 0;
    if (this.generation === 0) {
      this.visited.fill(0);
      this.generation = 1;
    }
    this.candidateIndices.length = 0;
    this.candidates.length = 0;
  }

  private addCell(cellX: number, cellZ: number): void {
    const entries = this.cells.get(gridKey(cellX, cellZ));
    if (!entries) return;
    for (const index of entries) {
      if (this.visited[index] === this.generation) continue;
      this.visited[index] = this.generation;
      this.candidateIndices.push(index);
    }
  }

  private finishQuery(): readonly T[] {
    this.candidateIndices.sort(compareNumbers);
    for (const index of this.candidateIndices) {
      const item = this.items[index];
      if (item) this.candidates.push(item);
    }
    return this.candidates;
  }

  private cell(value: number): number {
    return Math.floor(value / this.cellSize);
  }
}

function gridKey(cellX: number, cellZ: number): number {
  return (cellX + GRID_KEY_OFFSET) * GRID_KEY_STRIDE + cellZ + GRID_KEY_OFFSET;
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}
