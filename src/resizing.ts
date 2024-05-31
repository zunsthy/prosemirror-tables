/* eslint-disable no-inner-declarations */
import { Attrs, Node as ProsemirrorNode } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey, Transaction } from 'prosemirror-state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  NodeView,
} from 'prosemirror-view';
import { tableNodeTypes } from './schema';
import { TableMap } from './tablemap';
import { TableRowView, TableView, updateColumnsOnResize, updateRowsOnResize } from './tableview';
import { cellAround, CellAttrs, pointsAtCell, RowAttrs } from './util';

/**
 * @public
 */
export const resizingPluginKey = new PluginKey<ResizeState>(
  'tableResizing',
);

/**
 * @public
 */
export type ResizingOptions = {
  handleWidth?: number;
  cellMinWidth?: number;
  cellMinHeight?: number;
  lastColumnResizable?: boolean;
  lastRowResizable?: boolean;
  View?: new (
    node: ProsemirrorNode,
    cellMinWidth: number,
    cellMinHeight: number,
    view: EditorView,
  ) => NodeView;
  RowView?: new (
    node: ProsemirrorNode,
    cellMinHeight: number,
    view: EditorView,
  ) => NodeView;
};

type DraggingX = { startX: number; startWidth: number };
type DraggingY = { startY: number; startHeight: number };
/**
 * @public
 */
export type Dragging = DraggingX | DraggingY;

/**
 * @public
 */
export type Direction = 'horiz' | 'vert';

/**
 * @public
 */
export function tableCellResizing({
  handleWidth = 5,
  cellMinWidth = 25,
  cellMinHeight = 25,
  View = TableView,
  RowView = TableRowView,
  lastColumnResizable = true,
  lastRowResizable = true,
}: ResizingOptions = {}): Plugin {
  const plugin = new Plugin<ResizeState>({
    key: resizingPluginKey,
    state: {
      init(_, state) {
        const types = tableNodeTypes(state.schema);
        plugin.spec!.props!.nodeViews![
          types.table.name
        ] = (node, view) => new View(node, cellMinWidth, cellMinHeight, view);
        plugin.spec!.props!.nodeViews![
          types.row.name
        ] = (node, view) => new RowView(node, cellMinHeight, view);
        return new ResizeState(-1, false, false);
      },
      apply(tr, prev) {
        return prev.apply(tr);
      },
    },
    props: {
      attributes: (state): Record<string, string> => {
        const pluginState = resizingPluginKey.getState(state);
        return pluginState && pluginState.activeHandle > -1
          ? { class: 'resize-cursor ' + pluginState.direction || '' }
          : {};
      },

      handleDOMEvents: {
        mousemove: (view, event) => {
          handleMouseMove(
            view,
            event,
            handleWidth,
            cellMinWidth,
            lastColumnResizable,
            lastRowResizable,
          );
        },
        mouseleave: (view) => {
          handleMouseLeave(view);
        },
        mousedown: (view, event) => {
          handleMouseDown(view, event, cellMinWidth, cellMinHeight);
        },
      },

      decorations: (state) => {
        const pluginState = resizingPluginKey.getState(state);
        if (pluginState && pluginState.activeHandle > -1) {
          return handleDecorations(state, pluginState.activeHandle, pluginState.direction);
        }
      },

      nodeViews: {},
    },
  });
  return plugin;
}

/**
 * @public
 */
export class ResizeState {
  constructor(public activeHandle: number, public dragging: Dragging | false, public direction: Direction | false) {}

  apply(tr: Transaction): ResizeState {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const state = this;
    const action = tr.getMeta(resizingPluginKey);

    if (action && action.setHandle != null)
      return new ResizeState(action.setHandle, false, action.setHandle > -1 ? action.direction : false);
    if (action && action.setDragging !== undefined)
      return new ResizeState(state.activeHandle, action.setDragging, state.direction);
    if (state.activeHandle > -1 && tr.docChanged) {
      let handle = tr.mapping.map(state.activeHandle, -1);
      if (!pointsAtCell(tr.doc.resolve(handle))) {
        handle = -1;
      }
      return new ResizeState(handle, state.dragging, state.direction);
    }
    return state;
  }
}

function handleMouseMove(
  view: EditorView,
  event: MouseEvent,
  handleWidth: number,
  cellMinWidth: number,
  lastColumnResizable: boolean,
  lastRowResizable: boolean,
): void {
  const pluginState = resizingPluginKey.getState(view.state);
  if (!pluginState) return;

  if (!pluginState.dragging) {
    const target = domCellAround(event.target as HTMLElement);
    
    let cell = -1;
    let direction: Direction | false = false;
    if (target) {
      const { top, bottom, left, right } = target.getBoundingClientRect();
      if (event.clientX - left <= handleWidth) {
        cell = edgeCell(view, event, 'left', handleWidth);
        direction = 'horiz';
      } else if (right - event.clientX <= handleWidth) {
        cell = edgeCell(view, event, 'right', handleWidth);
        direction = 'horiz';
      } else if (event.clientY - top <= handleWidth) {
        cell = edgeCell(view, event, 'top', handleWidth);
        direction = 'vert';
      } else if (bottom - event.clientY < handleWidth) {
        cell = edgeCell(view, event, 'bottom', handleWidth);
        direction = 'vert';
      }
    }

    if (cell != pluginState.activeHandle) {
      if ((!lastColumnResizable || !lastRowResizable) && cell !== -1) {
        const $cell = view.state.doc.resolve(cell);
        const table = $cell.node(-1);
        const map = TableMap.get(table);
        const tableStart = $cell.start(-1);

        if (direction == 'horiz' && !lastColumnResizable) {
          const col =
            map.colCount($cell.pos - tableStart) +
            $cell.nodeAfter!.attrs.colspan -
            1;
          if (col == map.width - 1) return;
        } else if (direction == 'vert' && !lastRowResizable) {
          const row =
            map.rowCount($cell.pos - tableStart) +
            $cell.nodeAfter!.attrs.rowspan -
            1;
          if (row == map.height - 1) return;
        }
      }

      updateHandle(view, cell, direction);
    }
  }
}

function handleMouseLeave(view: EditorView): void {
  const pluginState = resizingPluginKey.getState(view.state);
  if (pluginState && pluginState.activeHandle > -1 && !pluginState.dragging)
    updateHandle(view, -1, false);
}

function handleMouseDown(
  view: EditorView,
  event: MouseEvent,
  cellMinWidth: number,
  cellMinHeight: number,
): boolean {
  const win = view.dom.ownerDocument.defaultView ?? window;

  const pluginState = resizingPluginKey.getState(view.state);
  if (!pluginState || pluginState.activeHandle == -1 || pluginState.dragging)
    return false;

  if (pluginState.direction == 'horiz') {
    const cell = view.state.doc.nodeAt(pluginState.activeHandle)!;
    const width = currentColWidth(view, pluginState.activeHandle, cell.attrs);
    view.dispatch(
      view.state.tr.setMeta(resizingPluginKey, {
        setDragging: { startX: event.clientX, startWidth: width, direction: pluginState.direction },
      }),
    );
  } else if (pluginState.direction == 'vert') {
    // const $cell = view.state.doc.resolve(pluginState.activeHandle)!;
    // const rowPos = $cell.before();
    // const row = view.state.doc.nodeAt(rowPos)!;
    // const rowHeight = currentRowHeight(view, rowPos, row.attrs);
    const rowHeight = 0;
    const cell = view.state.doc.nodeAt(pluginState.activeHandle)!;
    const cellHeight = currentRowCellHeight(view, pluginState.activeHandle, cell.attrs);
    // combine with row height and cell rowheight
    const height = Math.max(rowHeight, cellHeight);
    view.dispatch(
      view.state.tr.setMeta(resizingPluginKey, {
        setDragging: { startY: event.clientY, startHeight: height, direction: pluginState.direction },
      }),
    );
  }

  function finish(event: MouseEvent) {
    win.removeEventListener('mouseup', finish);
    win.removeEventListener('mousemove', move);
    const pluginState = resizingPluginKey.getState(view.state);
    if (pluginState?.dragging) {
      if (pluginState?.direction === 'horiz') {
        updateColumnWidth(
          view,
          pluginState.activeHandle,
          draggedWidth(pluginState.dragging as DraggingX, event, cellMinWidth),
        );
      } else if (pluginState?.direction === 'vert') {
        updateRowHeight(
          view,
          pluginState.activeHandle,
          draggedHeight(pluginState.dragging as DraggingY, event, cellMinHeight),
        );
      }
      view.dispatch(
        view.state.tr.setMeta(resizingPluginKey, { setDragging: null }),
      );
    }
  }

  function move(event: MouseEvent): void {
    if (!event.which) return finish(event);
    const pluginState = resizingPluginKey.getState(view.state);
    if (!pluginState) return;
    if (pluginState.dragging && pluginState?.direction === 'horiz') {
      const dragged = draggedWidth(pluginState.dragging as DraggingX, event, cellMinWidth);
      displayColumnWidth(view, pluginState.activeHandle, dragged, cellMinWidth);
    } else if (pluginState.dragging && pluginState?.direction === 'vert') {
      const dragged = draggedHeight(pluginState.dragging as DraggingY, event, cellMinHeight);
      displayRowHeight(view, pluginState.activeHandle, dragged, cellMinHeight);
    }
  }

  win.addEventListener('mouseup', finish);
  win.addEventListener('mousemove', move);
  event.preventDefault();
  return true;
}

function currentColWidth(
  view: EditorView,
  cellPos: number,
  { colspan, colwidth }: Attrs,
): number {
  const width = colwidth && colwidth[colwidth.length - 1];
  if (width) return width;
  const dom = view.domAtPos(cellPos);
  const node = dom.node.childNodes[dom.offset] as HTMLElement;
  let domWidth = node.offsetWidth,
    parts = colspan;
  if (colwidth)
    for (let i = 0; i < colspan; i++)
      if (colwidth[i]) {
        domWidth -= colwidth[i];
        parts--;
      }
  return domWidth / parts;
}

function currentRowCellHeight(
  view: EditorView,
  cellPos: number,
  { rowspan, rowheight }: Attrs,
): number {
  const height = rowheight && rowheight[rowspan - 1];
  if (height) return height;
  const dom = view.domAtPos(cellPos);
  const node = dom.node.childNodes[dom.offset] as HTMLElement;
  let domHeight = node.offsetHeight,
    parts = rowspan;
  if (rowheight) 
    for (let i = 0; i < rowspan; i++)
      if (rowheight[i]) {
        domHeight -= rowheight[i];
        parts--;
      }
  return domHeight / parts;
}

// function currentRowHeight(
//   view: EditorView,
//   rowPos: number,
//   { rowheight }: Attrs,
// ): number {
//   // only one data
//   const height = rowheight && rowheight[0];
//   if (height) return height;
//   const dom = view.domAtPos(rowPos);
//   const node = dom.node.childNodes[dom.offset] as HTMLElement;
//   return node.offsetHeight;
// }

function domCellAround(target: HTMLElement | null): HTMLElement | null {
  while (target && target.nodeName != 'TD' && target.nodeName != 'TH')
    target =
      target.classList && target.classList.contains('ProseMirror')
        ? null
        : (target.parentNode as HTMLElement);
  return target;
}

function edgeCell(
  view: EditorView,
  event: MouseEvent,
  side: 'top' | 'bottom' | 'left' | 'right',
  handleWidth: number,
): number {
  // posAtCoords returns inconsistent positions when cursor is moving
  // across a collapsed table border. Use an offset to adjust the
  // target viewport coordinates away from the table border.
  const offset = side == 'right' || side === 'bottom' ? -handleWidth : handleWidth;
  const found = view.posAtCoords(side === 'right' || side === 'left' ? {
    left: event.clientX + offset,
    top: event.clientY,
  } : {
    left: event.clientX,
    top: event.clientY + offset,
  });
  if (!found) return -1;
  const { pos } = found;
  const $cell = cellAround(view.state.doc.resolve(pos));
  if (!$cell) return -1;
  if (side == 'right' || side === 'bottom') return $cell.pos;
  const map = TableMap.get($cell.node(-1)),
    start = $cell.start(-1);
  const index = map.map.indexOf($cell.pos - start);
  if (side === 'left') {
    // no cell edge at first column
    return index % map.width == 0 ? -1 : start + map.map[index - 1];
    } else {
    // no cell edge at first row
    return Math.floor(index / map.width) == 0 ? -1 : start + map.map[index - map.width];
  }
}

function draggedWidth(
  dragging: DraggingX,
  event: MouseEvent,
  cellMinWidth: number,
): number {
  const offset = event.clientX - dragging.startX;
  return Math.max(cellMinWidth, dragging.startWidth + offset);
}

function draggedHeight(
  dragging: DraggingY,
  event: MouseEvent,
  cellMinHeight: number,
): number {
  const offset = event.clientY - dragging.startY;
  return Math.max(cellMinHeight, dragging.startHeight + offset);
}

function updateHandle(view: EditorView, value: number, direction: Direction | false): void {
  view.dispatch(
    view.state.tr.setMeta(resizingPluginKey, { setHandle: value, direction }),
  );
}

function updateColumnWidth(
  view: EditorView,
  cell: number,
  width: number,
): void {
  const $cell = view.state.doc.resolve(cell);
  const table = $cell.node(-1),
    map = TableMap.get(table),
    start = $cell.start(-1);
  const col =
    map.colCount($cell.pos - start) + $cell.nodeAfter!.attrs.colspan - 1;
  const tr = view.state.tr;
  for (let row = 0; row < map.height; row++) {
    const mapIndex = row * map.width + col;
    // Rowspanning cell that has already been handled
    if (row && map.map[mapIndex] == map.map[mapIndex - map.width]) continue;
    const pos = map.map[mapIndex];
    const attrs = table.nodeAt(pos)!.attrs as CellAttrs;
    const index = attrs.colspan == 1 ? 0 : col - map.colCount(pos);
    // the same width
    if (attrs.colwidth && attrs.colwidth[index] == width) continue;
    const colwidth = attrs.colwidth
      ? attrs.colwidth.slice()
      : zeroes(attrs.colspan);
    colwidth[index] = width;
    tr.setNodeMarkup(start + pos, null, { ...attrs, colwidth: colwidth });
  }
  if (tr.docChanged) view.dispatch(tr);
}

function updateRowHeight(
  view: EditorView,
  cell: number,
  height: number,
): void {
  const $cell = view.state.doc.resolve(cell);
  const table = $cell.node(-1),
    map = TableMap.get(table),
    start = $cell.start(-1);
  const row = map.rowCount($cell.pos - start) + $cell.nodeAfter!.attrs.rowspan - 1;
  const tr = view.state.tr;
  for (let col = 0; col < map.width; col++) {
    const mapIndex = col + row * map.width;
    // colspaning cell that has already been handled
    if (row && map.map[mapIndex] == map.map[mapIndex - 1]) continue;
    const pos = map.map[mapIndex];
    const attrs = table.nodeAt(pos)!.attrs as CellAttrs;
    const index = attrs.rowspan == 1 ? 0 : row - map.rowCount(pos);
    // the same height
    if (attrs.rowheight && attrs.rowheight[index] == height) continue;
    const rowheight = attrs.rowheight
      ? attrs.rowheight.slice()
      : zeroes(attrs.rowspan)
    rowheight[index] = height;
    tr.setNodeMarkup(start + pos, null, { ...attrs, rowheight });
  }

  const $row = view.state.doc.resolve($cell.before());
  const attrs = $row.node().attrs as RowAttrs;
  tr.setNodeMarkup($row.pos, null, { ...attrs, rowheight: [height] });

  if (tr.docChanged) view.dispatch(tr);
}

function displayColumnWidth(
  view: EditorView,
  cell: number,
  width: number,
  cellMinWidth: number,
): void {
  const $cell = view.state.doc.resolve(cell);
  const table = $cell.node(-1),
    start = $cell.start(-1);
  const col =
    TableMap.get(table).colCount($cell.pos - start) +
    $cell.nodeAfter!.attrs.colspan -
    1;
  let dom: Node | null = view.domAtPos($cell.start(-1)).node;
  // ???
  while (dom && dom.nodeName != 'TABLE') {
    dom = dom.parentNode;
  }
  if (!dom) return;
  updateColumnsOnResize(
    table,
    dom.firstChild as HTMLTableColElement,
    dom as HTMLTableElement,
    cellMinWidth,
    col,
    width,
  );
}

function displayRowHeight(
  view: EditorView,
  cell: number,
  height: number,
  cellMinHeight: number,
): void {
  const $cell = view.state.doc.resolve(cell);
  const table = $cell.node(-1),
    start = $cell.start(-1);
  const row =
    TableMap.get(table).rowCount($cell.pos - start) +
    $cell.nodeAfter!.attrs.rowspan -
    1;
  const tbodyDom: Node | null = view.domAtPos($cell.start(-1)).node;
  if (!tbodyDom) return;
  let dom: Node | null = tbodyDom;
  while (dom && dom.nodeName != 'TABLE') {
    dom = dom.parentNode;
  }
  if (!dom) return;
  updateRowsOnResize(
    table,
    // <tbody> element as row collection
    tbodyDom as HTMLTableSectionElement,
    dom as HTMLTableElement,
    cellMinHeight,
    row,
    height,
  );
}

function zeroes(n: number): 0[] {
  return Array(n).fill(0);
}

export function handleDecorations(
  state: EditorState,
  cell: number,
  direction: Direction | false,
): DecorationSet {
  const decorations = [];
  const $cell = state.doc.resolve(cell);
  const table = $cell.node(-1);
  if (!table) {
    return DecorationSet.empty;
  }
  const map = TableMap.get(table);

  const start = $cell.start(-1);
  if (direction == 'horiz') {
    // base 0
    const col = map.colCount($cell.pos - start) + $cell.nodeAfter!.attrs.colspan - 1;
    for (let row = 0; row < map.height; row++) {
      const index = col + row * map.width;
      // For positions that have either a different cell or the end
      // of the table to their right, and either the top of the table or
      // a different cell above them, add a decoration
      if (
        (col - 1 == map.width || map.map[index] != map.map[index + 1]) &&
        (row == 0 || map.map[index] != map.map[index - map.width])
      ) {
        const cellPos = map.map[index];
        // cell end
        const pos = start + cellPos + table.nodeAt(cellPos)!.nodeSize - 1;
        const dom = document.createElement('div');
        dom.className = 'column-resize-handle';
        decorations.push(Decoration.widget(pos, dom));
      }
    }
  } else if (direction == 'vert') {
    const row = map.rowCount($cell.pos - start) + $cell.nodeAfter!.attrs.rowspan - 1;
    // let needLinethrough = false;
    for (let col = 0; col < map.width; col++) {
      const index = col + row * map.width;
      // break the resize-handle, if span multiple row
      if (row != map.height - 1 && map.map[index] == map.map[index + map.width]) {
        // needLinethrough = true;
      } else if (
        // different with the left or on the table edge
        // (row == map.height - 1 || map.map[index] != map.map[index + map.width]) &&
        (col == 0 || map.map[index] != map.map[index - 1])
      ) {
        const cellPos = map.map[index];
        // cell end
        const pos = start + cellPos + table.nodeAt(cellPos)!.nodeSize - 1;
        const dom = document.createElement('div');
        dom.className = 'row-resize-handle';
        decorations.push(Decoration.widget(pos, dom));
      }
    }
    // if (needLinethrough) {
    //   // clear cell decorations
    //   decorations.length = 0;
    //   //          <tr> <td>
    //   // cell pos     ^     
    //   // resolve cell will be table row position
    //   const $row = $cell.node(0).resolve($cell.before());
    //   const dom = document.createElement('div');
    //   dom.className = 'row-resize-handle';
    //   decorations.push(Decoration.widget($row.pos, dom));
    // }
  }
  return DecorationSet.create(state.doc, decorations);
}
