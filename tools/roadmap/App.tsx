import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  applyNodeChanges,
  type NodeMouseHandler,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import designDoc from "../../docs/DESIGN.md?raw";
import { parseMarkers, areasOf, sectionAround, STATUSES, type Status } from "../../scripts/roadmapParse";
import { areaColours, buildGraph, buildEdges, type ColourMode } from "./graph";
import { ItemNodeView } from "./ItemNode";
import { AreaGroupNode } from "./AreaGroupNode";
import { TicketGroupNode } from "./TicketGroupNode";
import { loadPositions, savePositions, loadSizes, saveSizes, clearLayout, type BoxSize } from "./positions";
import { LockContext } from "./lockContext";
import type { RoadmapItem } from "../../scripts/roadmapParse";

const nodeTypes = { item: ItemNodeView, area: AreaGroupNode, ticket: TicketGroupNode };
const STATUS_KEYS = Object.keys(STATUSES) as Status[];
const COLOUR_MODES: ColourMode[] = ["status", "area"];
const GRID = 20; // drag/resize snap grid, aligned to the background dots

export function App() {
  const items = useMemo(() => parseMarkers(designDoc), []);
  const areas = useMemo(() => areasOf(items), [items]);
  const colours = useMemo(() => areaColours(areas), [areas]);

  const [hiddenAreas, setHiddenAreas] = useState<Set<string>>(new Set());
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<Status>>(new Set());
  const [colourMode, setColourMode] = useState<ColourMode>("area");
  const [locked, setLocked] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null); // a node with a dependency path, hovered
  const [layoutNonce, setLayoutNonce] = useState(0); // bump to force a fresh auto-layout (e.g. after reset)

  // Node ids that arm hover highlighting: every ticket that touches a dependency path, plus the `area:*` boxes
  // that have an external (cross-area) link. Hovering anything else (a dependency-free card, or an area box
  // with only internal paths) does nothing, so it never restyles the edges for nothing.
  const linkedNodes = useMemo(() => {
    const areaOf = (id: string) => id.split("-")[0];
    const linked = new Set<string>();
    for (const item of items) {
      for (const dep of item.deps) {
        linked.add(dep).add(item.id);
        if (areaOf(dep) !== areaOf(item.id)) {
          linked.add(`area:${areaOf(dep)}`).add(`area:${areaOf(item.id)}`);
        }
      }
    }
    return linked;
  }, [items]);

  const visibleItems = useMemo(
    () => items.filter((item) => !hiddenAreas.has(item.area) && !hiddenStatuses.has(item.status)),
    [items, hiddenAreas, hiddenStatuses],
  );

  // Which node ids the filters hide. A leaf hides on its own area/status; a container (parent ticket or
  // area box) hides only when everything inside it is hidden, so filtering never orphans a visible child.
  const hiddenIds = useMemo(() => {
    const childrenByParent = new Map<string, RoadmapItem[]>();
    for (const item of items) {
      if (!item.parent) continue;
      const siblings = childrenByParent.get(item.parent);
      if (siblings) siblings.push(item);
      else childrenByParent.set(item.parent, [item]);
    }
    const directlyHidden = (item: RoadmapItem) => hiddenAreas.has(item.area) || hiddenStatuses.has(item.status);
    const memo = new Map<string, boolean>();
    const isHidden = (item: RoadmapItem): boolean => {
      const cached = memo.get(item.id);
      if (cached !== undefined) return cached;
      const children = childrenByParent.get(item.id);
      const hidden = children ? children.every(isHidden) : directlyHidden(item);
      memo.set(item.id, hidden);
      return hidden;
    };
    const hidden = new Set<string>();
    for (const item of items) if (isHidden(item)) hidden.add(item.id);
    return hidden;
  }, [items, hiddenAreas, hiddenStatuses]);

  // React Flow needs controlled node/edge state (with change handlers) for dragging to take effect. The
  // layout is rebuilt from the markers whenever the filters/colour/selection change, but any node the user
  // has dragged keeps its manual position (tracked in `draggedPositions`), so re-layouts don't undo drags.
  const [nodes, setNodes] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  // Manual layout overrides, applied on top of the auto-layout and persisted to localStorage: dragged node
  // positions and hand-resized box sizes. Both are keyed by node id, so they survive re-layouts and reloads.
  const draggedPositions = useRef<Record<string, XYPosition>>(loadPositions());
  const resizedSizes = useRef<Record<string, BoxSize>>(loadSizes());

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      let positionEnded = false;
      let sizeEnded = false;
      for (const change of changes) {
        if (change.type === "position" && change.position) {
          draggedPositions.current[change.id] = change.position;
          if (change.dragging === false) positionEnded = true;
        } else if (change.type === "dimensions" && change.dimensions) {
          resizedSizes.current[change.id] = change.dimensions;
          if (change.resizing === false) sizeEnded = true;
        }
      }
      if (positionEnded) savePositions(draggedPositions.current);
      if (sizeEnded) saveSizes(resizedSizes.current);
      setNodes((current) => applyNodeChanges(changes, current));
    },
    [setNodes],
  );

  const resetLayout = useCallback(() => {
    const hasManualLayout =
      Object.keys(draggedPositions.current).length > 0 || Object.keys(resizedSizes.current).length > 0;
    if (hasManualLayout && !window.confirm("Reset the layout? This discards your saved node positions and sizes.")) {
      return;
    }
    clearLayout();
    draggedPositions.current = {};
    resizedSizes.current = {};
    setLayoutNonce((nonce) => nonce + 1);
  }, []);

  useEffect(() => {
    // Lay out the full item set (so filtering only toggles `hidden`, never re-flows), then apply the manual
    // position/size overrides. Nodes deliberately do NOT depend on `hoveredId` - hover restyles edges only
    // (see the edge effect below), so it never rebuilds and repaints the node layer.
    const nodes = buildGraph(items, areas, colours, colourMode, selectedId, hiddenIds);
    setNodes(
      nodes.map((node) => {
        const dragged = draggedPositions.current[node.id];
        const resized = resizedSizes.current[node.id];
        const position = dragged ?? node.position;
        const style = resized ? { ...node.style, width: resized.width, height: resized.height } : node.style;
        return { ...node, position, style };
      }),
    );
    // layoutNonce forces a re-run after a reset (the override refs were cleared).
  }, [items, areas, colours, colourMode, selectedId, hiddenIds, layoutNonce, setNodes]);

  // Edges are their own layer: hover and selection restyle them here without touching the node layout above.
  useEffect(() => {
    setEdges(buildEdges(items, colours, colourMode, selectedId, hoveredId, hiddenIds));
  }, [items, colours, colourMode, selectedId, hoveredId, hiddenIds, setEdges]);

  const selected = selectedId ? (items.find((item) => item.id === selectedId) ?? null) : null;
  const detail = selected ? sectionAround(designDoc, selected.line) : "";

  const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const onNodeClick: NodeMouseHandler = (_event, node) => {
    if (node.type === "item" || node.type === "ticket") {
      setSelectedId((node.data as { item: RoadmapItem }).item.id);
    }
  };

  // Hover a node (ticket or area box) that has a dependency path to highlight every path touching it; ignore
  // the dependency-free cards so hovering them never restyles the edges for nothing.
  const onNodeMouseEnter: NodeMouseHandler = (_event, node) => {
    if (linkedNodes.has(node.id)) setHoveredId(node.id);
  };
  const onNodeMouseLeave: NodeMouseHandler = () => setHoveredId(null);

  const counts = useMemo(() => {
    const byArea = new Map<string, number>();
    const byStatus = new Map<Status, number>();
    for (const item of items) {
      byArea.set(item.area, (byArea.get(item.area) ?? 0) + 1);
      byStatus.set(item.status, (byStatus.get(item.status) ?? 0) + 1);
    }
    return { byArea, byStatus };
  }, [items]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__title">
          <strong>web-daw</strong> roadmap
          <span className="topbar__sub">
            {visibleItems.length} of {items.length} items - single source: docs/DESIGN.md
          </span>
        </div>
        <div className="filters">
          <div className="filters__group">
            {areas.map((area) => (
              <button
                key={area}
                className="chip"
                data-off={hiddenAreas.has(area)}
                style={{ "--area": colours[area] } as React.CSSProperties}
                onClick={() => setHiddenAreas((set) => toggle(set, area))}
              >
                <span className="chip__dot" />
                {area}
                <span className="chip__count">{counts.byArea.get(area)}</span>
              </button>
            ))}
          </div>
          <div className="filters__group">
            {STATUS_KEYS.map((status) => (
              <button
                key={status}
                className="chip"
                data-off={hiddenStatuses.has(status)}
                style={{ "--area": STATUSES[status].colour } as React.CSSProperties}
                onClick={() => setHiddenStatuses((set) => toggle(set, status))}
              >
                <span className="chip__dot" />
                {STATUSES[status].label}
                <span className="chip__count">{counts.byStatus.get(status) ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="segmented" role="group" aria-label="Colour by">
            <span className="segmented__label">colour</span>
            {COLOUR_MODES.map((mode) => (
              <button
                key={mode}
                className="segmented__btn"
                data-on={colourMode === mode}
                onClick={() => setColourMode(mode)}
              >
                {mode}
              </button>
            ))}
          </div>
          <button
            className="chip"
            data-on={locked}
            onClick={() => setLocked((value) => !value)}
            title={locked ? "Unlock to drag / resize nodes" : "Lock the layout: pan without moving nodes"}
          >
            {locked ? "🔒 locked" : "🔓 lock"}
          </button>
          <button className="chip" onClick={resetLayout} title="Clear saved positions and re-run auto-layout">
            reset layout
          </button>
        </div>
      </header>

      <div className="body">
        <div className="graph">
          <LockContext.Provider value={locked}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={handleNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              onNodeMouseEnter={onNodeMouseEnter}
              onNodeMouseLeave={onNodeMouseLeave}
              onPaneClick={() => setSelectedId(null)}
              nodesDraggable={!locked}
              fitView
              snapToGrid
              snapGrid={[GRID, GRID]}
              minZoom={0.2}
              maxZoom={1.75}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={GRID} color="#232a33" />
              <MiniMap
                pannable
                zoomable
                nodeColor={(node) => (node.data as { colour?: string }).colour ?? "#2b3644"}
                nodeStrokeColor="#0b0f14"
                nodeBorderRadius={4}
                maskColor="rgba(11,15,20,0.6)"
              />
              <Controls />
            </ReactFlow>
          </LockContext.Provider>
        </div>

        {selected && (
          <aside className="detail">
            <div className="detail__head">
              <div>
                <span className="detail__id" style={{ color: colours[selected.area] }}>
                  {selected.id}
                </span>
                <span className="detail__status">
                  {STATUSES[selected.status].icon} {STATUSES[selected.status].label}
                </span>
              </div>
              <button className="detail__close" onClick={() => setSelectedId(null)} aria-label="Close">
                ×
              </button>
            </div>
            {selected.deps.length > 0 && (
              <div className="detail__deps">
                depends on:{" "}
                {selected.deps.map((dep, index) => (
                  <span key={dep}>
                    {index > 0 && ", "}
                    <button className="detail__dep" onClick={() => setSelectedId(dep)}>
                      {dep}
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="detail__doc">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail}</ReactMarkdown>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
