import React, { useMemo } from 'react';
import { DiskTreeNode } from '../types.js';
import { formatBytes } from '../utils/formatters.js';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LaidOutNode {
  node: DiskTreeNode;
  rect: Rect;
}

// Squarified treemap layout (Bruls/Huizing/Wijk). Operates on one level of
// children at a time - the parent page re-lays-out from scratch whenever
// the drill-down cursor changes, which is cheap since a folder's own
// children list is at most ~40 files + subdirs (see MAX_FILES_PER_DIR in
// disk-scan.service.ts).
function squarify(nodes: DiskTreeNode[], rect: Rect): LaidOutNode[] {
  const total = nodes.reduce((sum, n) => sum + n.sizeBytes, 0);
  if (total <= 0 || nodes.length === 0) return [];

  const result: LaidOutNode[] = [];
  let remaining = [...nodes];
  let box = { ...rect };

  while (remaining.length > 0) {
    const shortSide = Math.min(box.w, box.h);
    let row: DiskTreeNode[] = [remaining[0]];
    let rowSize = remaining[0].sizeBytes;
    let bestWorst = worstRatio(row, rowSize, total, box, shortSide);

    let i = 1;
    while (i < remaining.length) {
      const candidateRow = [...row, remaining[i]];
      const candidateSize = rowSize + remaining[i].sizeBytes;
      const candidateWorst = worstRatio(candidateRow, candidateSize, total, box, shortSide);
      if (candidateWorst <= bestWorst) {
        row = candidateRow;
        rowSize = candidateSize;
        bestWorst = candidateWorst;
        i++;
      } else {
        break;
      }
    }

    const rowFraction = total > 0 ? rowSize / total : 0;
    const isHorizontal = box.w >= box.h;
    const rowLength = isHorizontal ? box.w : box.h;
    const rowThickness = rowFraction * (isHorizontal ? box.h : box.w);

    let cursor = isHorizontal ? box.y : box.x;
    for (const n of row) {
      const nodeFraction = rowSize > 0 ? n.sizeBytes / rowSize : 0;
      const nodeLength = nodeFraction * rowLength;
      if (isHorizontal) {
        result.push({ node: n, rect: { x: box.x, y: cursor, w: rowThickness, h: nodeLength } });
      } else {
        result.push({ node: n, rect: { x: cursor, y: box.y, w: nodeLength, h: rowThickness } });
      }
      cursor += nodeLength;
    }

    if (isHorizontal) {
      box = { x: box.x + rowThickness, y: box.y, w: box.w - rowThickness, h: box.h };
    } else {
      box = { x: box.x, y: box.y + rowThickness, w: box.w, h: box.h - rowThickness };
    }
    remaining = remaining.slice(row.length);
  }

  return result;
}

function worstRatio(row: DiskTreeNode[], rowSize: number, total: number, box: Rect, shortSide: number): number {
  if (rowSize === 0 || shortSide === 0) return Infinity;
  const rowFraction = rowSize / total;
  const isHorizontal = box.w >= box.h;
  const thickness = rowFraction * (isHorizontal ? box.h : box.w);
  if (thickness === 0) return Infinity;
  let worst = 0;
  for (const n of row) {
    const nodeFraction = n.sizeBytes / rowSize;
    const length = nodeFraction * (isHorizontal ? box.w : box.h);
    const ratio = Math.max(thickness / length, length / thickness);
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

// Depth-independent color bucket by node type + a hash of the name, so the
// same folder keeps a stable color across re-layouts instead of flickering
// when sibling order changes.
function colorFor(node: DiskTreeNode): string {
  if (node.type === 'rollup') return 'var(--cockpit-border)';
  let hash = 0;
  for (let i = 0; i < node.name.length; i++) hash = (hash * 31 + node.name.charCodeAt(i)) >>> 0;
  const hues = node.type === 'dir'
    ? [210, 195, 225, 180, 240]
    : [30, 45, 15, 50, 20];
  const hue = hues[hash % hues.length];
  const lightness = node.type === 'dir' ? 42 : 38;
  return `hsl(${hue} 55% ${lightness}%)`;
}

interface TreemapProps {
  nodes: DiskTreeNode[];
  width: number;
  height: number;
  onDrillDown: (node: DiskTreeNode) => void;
}

export const Treemap: React.FC<TreemapProps> = ({ nodes, width, height, onDrillDown }) => {
  const laidOut = useMemo(
    () => squarify(nodes, { x: 0, y: 0, w: width, h: height }),
    [nodes, width, height]
  );

  if (width <= 0 || height <= 0) return null;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" className="select-none">
      {laidOut.map(({ node, rect }) => {
        const canDrill = node.type === 'dir' && node.children.length > 0;
        const showLabel = rect.w > 46 && rect.h > 18;
        return (
          <g
            key={node.path}
            onClick={() => canDrill && onDrillDown(node)}
            className={canDrill ? 'cursor-pointer' : 'cursor-default'}
          >
            <rect
              x={rect.x}
              y={rect.y}
              width={Math.max(0, rect.w - 1)}
              height={Math.max(0, rect.h - 1)}
              fill={colorFor(node)}
              stroke="var(--cockpit-bg)"
              strokeWidth={1}
            >
              <title>
                {`${node.name}\n${formatBytes(node.sizeBytes)}${node.type === 'dir' ? ` · ${node.fileCount} files` : ''}`}
              </title>
            </rect>
            {showLabel && (
              <foreignObject x={rect.x + 3} y={rect.y + 2} width={Math.max(0, rect.w - 6)} height={Math.max(0, rect.h - 4)}>
                <div className="pointer-events-none flex h-full flex-col justify-start overflow-hidden font-mono text-[10px] leading-tight text-white/90">
                  <span className="truncate font-bold">{node.name}</span>
                  <span className="truncate text-white/70">{formatBytes(node.sizeBytes)}</span>
                </div>
              </foreignObject>
            )}
          </g>
        );
      })}
    </svg>
  );
};
