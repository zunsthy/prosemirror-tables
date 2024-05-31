import { Node } from 'prosemirror-model';
import { NodeView } from 'prosemirror-view';
import { CellAttrs, RowAttrs } from './util';

/**
 * @public
 */
export class TableView implements NodeView {
  public dom: HTMLDivElement;
  public table: HTMLTableElement;
  public tbody: HTMLTableSectionElement;
  public colgroup: HTMLTableColElement;
  public contentDOM: HTMLTableSectionElement;

  constructor(public node: Node, public cellMinWidth: number, public cellMinHeight: number) {
    this.dom = document.createElement('div');
    this.dom.className = 'tableWrapper';
    this.table = this.dom.appendChild(document.createElement('table'));
    this.colgroup = this.table.appendChild(document.createElement('colgroup'));
    this.tbody = this.table.appendChild(document.createElement('tbody'));
    updateColumnsOnResize(node, this.colgroup, this.table, cellMinWidth);
    updateRowsOnResize(node, this.tbody, this.table, cellMinHeight);
    this.contentDOM = this.tbody;
  }

  update(node: Node): boolean {
    if (node.type != this.node.type) return false;
    this.node = node;
    updateColumnsOnResize(node, this.colgroup, this.table, this.cellMinWidth);
    updateRowsOnResize(node, this.tbody, this.table, this.cellMinHeight);
    return true;
  }

  ignoreMutation(record: MutationRecord): boolean {
    return (
      record.type == 'attributes' &&
      (record.target == this.table || this.colgroup.contains(record.target))
    );
  }
}

/**
 * @public
 */
export function updateColumnsOnResize(
  node: Node,
  colgroup: HTMLTableColElement,
  table: HTMLTableElement,
  cellMinWidth: number,
  overrideCol?: number,
  overrideValue?: number,
): void {
  let totalWidth = 0;
  let fixedWidth = true;
  let nextDOM = colgroup.firstChild as HTMLElement;
  // ??? why first only child
  const row = node.firstChild;
  if (!row) return;

  for (let i = 0, col = 0; i < row.childCount; i++) {
    const { colspan, colwidth } = row.child(i).attrs as CellAttrs;
    for (let j = 0; j < colspan; j++, col++) {
      const hasWidth =
        overrideCol == col ? overrideValue : colwidth && colwidth[j];
      const cssWidth = hasWidth ? hasWidth + 'px' : '';
      totalWidth += hasWidth || cellMinWidth;
      if (!hasWidth) fixedWidth = false;
      if (!nextDOM) {
        colgroup.appendChild(document.createElement('col')).style.width =
          cssWidth;
      } else {
        if (nextDOM.style.width != cssWidth) nextDOM.style.width = cssWidth;
        nextDOM = nextDOM.nextSibling as HTMLElement;
      }
    }
  }

  while (nextDOM) {
    const after = nextDOM.nextSibling;
    nextDOM.parentNode?.removeChild(nextDOM);
    nextDOM = after as HTMLElement;
  }

  if (fixedWidth) {
    table.style.width = totalWidth + 'px';
    table.style.minWidth = '';
  } else {
    table.style.width = '';
    table.style.minWidth = totalWidth + 'px';
  }
}

export class TableRowView implements NodeView {
  public dom: HTMLTableRowElement;
  public contentDOM: HTMLTableRowElement;

  constructor(public node: Node, public cellMinHeight: number) {
    this.dom = document.createElement('tr');
    this.dom.className = 'tableRow';
    updateRow(node, this.dom, cellMinHeight);
    this.contentDOM = this.dom;
  }

  update(node: Node): boolean {
    if (node.type != this.node.type) return false;
    this.node = node;
    updateRow(node, this.dom, this.cellMinHeight);
    return true;
  }

  ignoreMutation(record: MutationRecord): boolean {
    return (
      record.type == 'attributes' &&
      (record.target == this.dom || this.dom.contains(record.target))
    );
  }
}

function updateRow(node: Node, rowElement: HTMLTableRowElement, cellMinHeight: number) {
  let totalHeight = 0;
  let fixedOutterHeight = true;
  let fixedHeight = true;

  const row = node;
  const { rowheight } = row.attrs as RowAttrs;
  const hasHeight = rowheight && rowheight[0];
  totalHeight = hasHeight || cellMinHeight;
  if (!hasHeight) fixedOutterHeight = false;

  // TODO: iterable every cell
  for (let i = 0; i < row.childCount; i++) {
    const { rowheight } = row.child(i).attrs as CellAttrs;
    // for (let j = 0; j < rowspan; j++) {
    // }
    const hasHeight = rowheight && rowheight[0];
    // const cssHeight = hasHeight ? hasHeight + 'px' : '';
    totalHeight = Math.max(totalHeight, hasHeight || cellMinHeight);
    if (!hasHeight) fixedHeight = false;
  }

  // table is stretch, min-* not working
  if (fixedOutterHeight || fixedHeight) {
    rowElement.style.height = totalHeight + 'px';
  } else {
    rowElement.style.height = '';
  }
  // if (fixedHeight) {
  //   rowElement.style.height = totalHeight + 'px';
  //   rowElement.style.minHeight = '';
  // } else {
  //   rowElement.style.height = '';
  //   rowElement.style.minHeight = totalHeight + 'px';
  // }

  // if (rowheight) {
  //   rowElement.dataset.rowheight = rowheight.join(',');
  // }
}

/**
 * @public
 */
export function updateRowsOnResize(
  node: Node,
  tbody: HTMLTableSectionElement,
  table: HTMLTableElement,
  cellMinHeight: number,
  overrideRow?: number,
  overrideValue?: number,
): void {
  let totalHeight = 0;
  let fixedHeight = true;

  for (let i = 0; i < node.childCount; i++) {
    const row = node.child(i);
    let cellHeight = 0;
    // row cell iterator
    for (let i = 0; i < row.childCount; i++) {
      const { rowheight } = row.child(i).attrs as CellAttrs;
      const hasHeight = rowheight && rowheight[0];
      if (hasHeight) {
        cellHeight = Math.max(hasHeight, cellHeight);
      }
    }
    
    const { rowheight } = row.attrs as RowAttrs;
    const rowHeight = Math.max(rowheight ? rowheight[0] : 0, cellHeight);
    // only one value
    const hasHeight =
      overrideRow == i ? overrideValue : rowHeight;
    const cssHeight = hasHeight ? hasHeight + 'px' : '';
    totalHeight += hasHeight || cellMinHeight;
    if (!hasHeight) fixedHeight = false;
    const rowNode = tbody.childNodes[i] as HTMLElement;
    if (rowNode) {
      rowNode.style.height = cssHeight;
    }
  }
  // no more rows

  // fixed total
  if (fixedHeight) {
    table.style.height = totalHeight + 'px';
  } else {
    table.style.height = '';
  }
}
