import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import { STATUSES, type RoadmapItem } from "../../scripts/roadmapParse";

export type ColourMode = "status" | "area";

/** Leaf ticket card payload. `colour` is the primary hue (status or area, per mode); `statusColour` always
 *  tracks status so the glyph stays a status signal even in area mode. */
export interface ItemNodeData extends Record<string, unknown> {
  item: RoadmapItem;
  colour: string;
  statusColour: string;
  selected: boolean;
  dimmed: boolean;
}
export type ItemNode = Node<ItemNodeData, "item">;

/** A parent ticket rendered as a container box (title bar + its child tickets inside). Selectable like a
 *  leaf (opens its doc block), but also frames its children. */
export interface TicketNodeData extends Record<string, unknown> {
  item: RoadmapItem;
  colour: string;
  statusColour: string;
  count: number;
  selected: boolean;
  dimmed: boolean;
}
export type TicketNode = Node<TicketNodeData, "ticket">;

/** An area (epic) container box. */
export interface AreaNodeData extends Record<string, unknown> {
  area: string;
  colour: string;
  count: number;
}
export type AreaNode = Node<AreaNodeData, "area">;

export type RoadmapNode = AreaNode | TicketNode | ItemNode;

/** A distinct hue per area, assigned by first-seen order (areas are open, so this cycles). */
const AREA_PALETTE = [
  "#4f9dff", // blue
  "#34d399", // green
  "#a884f3", // violet
  "#fbbf24", // amber
  "#f472b6", // pink
  "#22d3ee", // cyan
  "#fb923c", // orange
  "#a3e635", // lime
];

export function areaColours(areas: string[]): Record<string, string> {
  return Object.fromEntries(areas.map((area, index) => [area, AREA_PALETTE[index % AREA_PALETTE.length]]));
}

const ITEM_WIDTH = 212;
const ITEM_HEIGHT = 62;
const GAP = 22; // between grid cells
const PAD_X = 18; // box inner side padding
const PAD_TOP = 46; // box title bar
const PAD_BOTTOM = 20;
const AREA_GAP = 40; // between area boxes
const ROW_TARGET_WIDTH = 1640; // wrap area boxes onto a new row past this
const RANKSEP = 92; // dagre horizontal rank spacing (the flow direction)
const NODESEP = 30; // dagre spacing within a rank

interface Size {
  width: number;
  height: number;
}
interface Placement extends Size {
  x: number;
  y: number;
}

const childrenOf = (items: RoadmapItem[], parentId: string | null): RoadmapItem[] =>
  items.filter((item) => item.parent === parentId);

const columnsFor = (count: number): number => Math.max(1, Math.ceil(Math.sqrt(count)));

/** The rendered size of one item: a leaf card, or (if it has children) the box that frames them. */
function sizeOf(item: RoadmapItem, items: RoadmapItem[]): Size {
  const kids = childrenOf(items, item.id);
  if (kids.length === 0) return { width: ITEM_WIDTH, height: ITEM_HEIGHT };
  const box = layoutSiblings(kids, items).box;
  return { width: box.width, height: box.height };
}

/**
 * Lay a set of sibling tickets out relative to a (0,0) content origin. Siblings connected by dependencies
 * are ranked left-to-right with dagre (so the graph flows and links point forward); a dependency-free group
 * falls back to a squarish grid (dagre would otherwise stack them in one tall column). Returns each
 * sibling's placement (top-left, content-relative) and the enclosing box size (the content extent plus the
 * container's title/side/bottom padding), computed from the actual placements so a box always frames its
 * children.
 */
function layoutSiblings(
  siblings: RoadmapItem[],
  items: RoadmapItem[],
): { placements: Map<string, Placement>; box: Size } {
  const sizes = new Map(siblings.map((sibling) => [sibling.id, sizeOf(sibling, items)]));
  const siblingIds = new Set(siblings.map((sibling) => sibling.id));
  const intraEdges = siblings.flatMap((sibling) =>
    sibling.deps.filter((dep) => siblingIds.has(dep)).map((dep) => [dep, sibling.id] as const),
  );
  const placements = new Map<string, Placement>();

  if (intraEdges.length > 0) {
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({ rankdir: "LR", nodesep: NODESEP, ranksep: RANKSEP });
    graph.setDefaultEdgeLabel(() => ({}));
    // Pass dagre a fresh label object per node - dagre mutates it with the computed centre, and reusing the
    // `sizes` object would then leak that centre back into our placements.
    for (const sibling of siblings) {
      const size = sizes.get(sibling.id)!;
      graph.setNode(sibling.id, { width: size.width, height: size.height });
    }
    for (const [from, to] of intraEdges) graph.setEdge(from, to);
    dagre.layout(graph);

    let minX = Infinity;
    let minY = Infinity;
    for (const sibling of siblings) {
      const laid = graph.node(sibling.id);
      const size = sizes.get(sibling.id)!;
      placements.set(sibling.id, {
        x: laid.x - size.width / 2,
        y: laid.y - size.height / 2,
        width: size.width,
        height: size.height,
      });
      minX = Math.min(minX, laid.x - size.width / 2);
      minY = Math.min(minY, laid.y - size.height / 2);
    }
    for (const placement of placements.values()) {
      placement.x -= minX;
      placement.y -= minY;
    }
    return { placements, box: boxOf(placements) };
  }

  const columns = columnsFor(siblings.length);
  const cellWidth = Math.max(...siblings.map((sibling) => sizes.get(sibling.id)!.width));
  const cellHeight = Math.max(...siblings.map((sibling) => sizes.get(sibling.id)!.height));
  siblings.forEach((sibling, index) => {
    const size = sizes.get(sibling.id)!;
    placements.set(sibling.id, {
      x: (index % columns) * (cellWidth + GAP),
      y: Math.floor(index / columns) * (cellHeight + GAP),
      width: size.width,
      height: size.height,
    });
  });
  return { placements, box: boxOf(placements) };
}

/** The box that encloses a set of placed children: their extent plus the container padding (title bar on
 *  top, PAD_X either side, PAD_BOTTOM below). Children are positioned at PAD_X/PAD_TOP + placement, so this
 *  guarantees the frame always contains them. */
function boxOf(placements: Map<string, Placement>): Size {
  let right = 0;
  let bottom = 0;
  for (const placement of placements.values()) {
    right = Math.max(right, placement.x + placement.width);
    bottom = Math.max(bottom, placement.y + placement.height);
  }
  return { width: right + 2 * PAD_X, height: bottom + PAD_TOP + PAD_BOTTOM };
}

/**
 * Build the React Flow graph: one box per area, tickets laid out inside by dependency flow, parent tickets
 * framing their sub-tickets (nested boxes). Area boxes are packed into wrapping rows so the whole map fits a
 * screen. Dependency edges are drawn at the ticket level and flow forward (dep -> dependent). `colourMode`
 * chooses the item hue; `selectedId` drives the selection glow, neighbour highlight, and dimming.
 *
 * The layout always covers the FULL item set; filtering marks nodes `hidden` (via `hiddenIds`) rather than
 * removing them, so a filter change never re-flows the map - visible nodes keep their exact positions.
 */
export function buildGraph(
  items: RoadmapItem[],
  areas: string[],
  colours: Record<string, string>,
  colourMode: ColourMode,
  selectedId: string | null,
  hiddenIds: Set<string>,
): { nodes: RoadmapNode[]; edges: Edge[] } {
  const visibleIds = new Set(items.map((item) => item.id));
  const depEdges = items.flatMap((item) =>
    item.deps
      .filter((dep) => visibleIds.has(dep))
      .map((dep) => ({ id: `${dep}->${item.id}`, source: dep, target: item.id })),
  );
  const neighbours = selectedId
    ? new Set(
        depEdges
          .filter((edge) => edge.source === selectedId || edge.target === selectedId)
          .flatMap((edge) => [edge.source, edge.target]),
      )
    : null;

  const hueOf = (item: RoadmapItem): string =>
    colourMode === "area" ? (colours[item.area] ?? "#94a3b8") : (STATUSES[item.status]?.colour ?? "#94a3b8");
  const nodeDataFor = (item: RoadmapItem) => ({
    item,
    colour: hueOf(item),
    statusColour: STATUSES[item.status]?.colour ?? "#94a3b8",
    selected: item.id === selectedId,
    dimmed: neighbours ? !neighbours.has(item.id) : false,
  });

  // Lay a container's children out once and emit their nodes (positions relative to the container). A child
  // that has children of its own becomes a nested ticket-box and recurses. `parentId` (without `extent`)
  // keeps children moving with their box when it is dragged, but doesn't clamp the auto-layout into overlap.
  const buildContainer = (containerId: string, siblings: RoadmapItem[]): { nodes: RoadmapNode[]; box: Size } => {
    const { placements, box } = layoutSiblings(siblings, items);
    const nodes = siblings.flatMap((sibling): RoadmapNode[] => {
      const placement = placements.get(sibling.id)!;
      const position = { x: PAD_X + placement.x, y: PAD_TOP + placement.y };
      const kids = childrenOf(items, sibling.id);
      if (kids.length > 0) {
        const inner = buildContainer(sibling.id, kids);
        const ticketBox: TicketNode = {
          id: sibling.id,
          type: "ticket",
          parentId: containerId,
          position,
          hidden: hiddenIds.has(sibling.id),
          style: { width: inner.box.width, height: inner.box.height },
          data: { ...nodeDataFor(sibling), count: kids.length },
          zIndex: 1,
        };
        return [ticketBox, ...inner.nodes];
      }
      const leaf: ItemNode = {
        id: sibling.id,
        type: "item",
        parentId: containerId,
        position,
        hidden: hiddenIds.has(sibling.id),
        style: { width: ITEM_WIDTH, height: ITEM_HEIGHT },
        data: nodeDataFor(sibling),
        zIndex: 2,
      };
      return [leaf];
    });
    return { nodes, box };
  };

  const nodes: RoadmapNode[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  for (const area of areas) {
    const topTickets = items.filter((item) => item.area === area && item.parent === null);
    if (topTickets.length === 0) continue;

    const inner = buildContainer(`area:${area}`, topTickets);
    const boxWidth = inner.box.width;
    const boxHeight = inner.box.height;

    if (cursorX > 0 && cursorX + boxWidth > ROW_TARGET_WIDTH) {
      cursorX = 0;
      cursorY += rowHeight + AREA_GAP;
      rowHeight = 0;
    }

    const areaItems = items.filter((item) => item.area === area);
    const areaColour = colours[area] ?? "#94a3b8";
    const areaBox: AreaNode = {
      id: `area:${area}`,
      type: "area",
      position: { x: cursorX, y: cursorY },
      hidden: areaItems.every((item) => hiddenIds.has(item.id)), // hide the box only when nothing in it shows
      data: { area, colour: areaColour, count: areaItems.length },
      style: { width: boxWidth, height: boxHeight },
      zIndex: 0,
    };
    nodes.push(areaBox, ...inner.nodes);

    cursorX += boxWidth + AREA_GAP;
    rowHeight = Math.max(rowHeight, boxHeight);
  }

  const edges: Edge[] = depEdges.map((edge) => {
    const active = selectedId === edge.source || selectedId === edge.target;
    const targetItem = items.find((item) => item.id === edge.target);
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      pathOptions: { borderRadius: 12 },
      hidden: hiddenIds.has(edge.source) || hiddenIds.has(edge.target),
      animated: active,
      zIndex: active ? 20 : 5,
      style: {
        stroke: active && targetItem ? hueOf(targetItem) : "#7c8aa0",
        strokeWidth: active ? 2.5 : 1.5,
        opacity: selectedId ? (active ? 1 : 0.12) : 0.6,
      },
    };
  });

  return { nodes, edges };
}
