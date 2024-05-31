// Helper for creating a schema that supports tables.

import {
  AttributeSpec,
  Attrs,
  Node,
  NodeSpec,
  NodeType,
  Schema,
} from 'prosemirror-model';
import { CellAttrs, MutableAttrs, RowAttrs } from './util';

function getRowAttrs(dom: HTMLElement | string, extraAttrs: Attrs): Attrs {
  if (typeof dom === 'string') {
    return {};
  }

  const heightAttr = dom.getAttribute('data-rowheight');
  const heights = 
    heightAttr && /^\d+(,\d+)*$/.test(heightAttr)
      ? heightAttr.split(',').map((s) => Number(s))
      : null;
  const rowspan = 1;
  const result: MutableAttrs = {
    rowheight: heights && heights.length == rowspan ? heights : null,
  } satisfies RowAttrs;
  for (const prop in extraAttrs) {
    const getter = extraAttrs[prop].getFromDOM;
    const value = getter && getter(dom);
    if (value != null) {
      result[prop] = value;
    }
  }
  return result;
}

function getCellAttrs(dom: HTMLElement | string, extraAttrs: Attrs): Attrs {
  if (typeof dom === 'string') {
    return {};
  }

  const widthAttr = dom.getAttribute('data-colwidth');
  const widths =
    widthAttr && /^\d+(,\d+)*$/.test(widthAttr)
      ? widthAttr.split(',').map((s) => Number(s))
      : null;
  const heightAttr = dom.getAttribute('data-rowheight');
  const heights =
    heightAttr && /^\d+(,\d+)*$/.test(heightAttr)
      ? heightAttr.split(',').map((s) => Number(s))
      : null;
  const colspan = Number(dom.getAttribute('colspan') || 1);
  const rowspan = Number(dom.getAttribute('rowspan') || 1);
  const result: MutableAttrs = {
    colspan,
    rowspan,
    colwidth: widths && widths.length == colspan ? widths : null,
    rowheight: heights && heights.length == rowspan ? heights : null,
  } satisfies CellAttrs;
  for (const prop in extraAttrs) {
    const getter = extraAttrs[prop].getFromDOM;
    const value = getter && getter(dom);
    if (value != null) {
      result[prop] = value;
    }
  }
  return result;
}

function setRowAttrs(node: Node, extraAttrs: Attrs): Attrs {
  const attrs: MutableAttrs = {};
  if (node.attrs.rowheight) {
    attrs['data-rowheight'] = node.attrs.rowheight.join(',');
    // attrs.style = `height: ${node.attrs.rowheight}px`;
  }
  for (const prop in extraAttrs) {
    const setter = extraAttrs[prop].setDOMAttr;
    if (setter) setter(node.attrs[prop], attrs);
  }
  return attrs;
}

function setCellAttrs(node: Node, extraAttrs: Attrs): Attrs {
  const attrs: MutableAttrs = {};
  if (node.attrs.colspan != 1) attrs.colspan = node.attrs.colspan;
  if (node.attrs.rowspan != 1) attrs.rowspan = node.attrs.rowspan;
  if (node.attrs.colwidth)
    attrs['data-colwidth'] = node.attrs.colwidth.join(',');
  if (node.attrs.rowheight)
    attrs['data-rowheight'] = node.attrs.rowheight.join(',');
  for (const prop in extraAttrs) {
    const setter = extraAttrs[prop].setDOMAttr;
    if (setter) setter(node.attrs[prop], attrs);
  }
  return attrs;
}

/**
 * @public
 */
export type getFromDOM = (dom: HTMLElement) => unknown;

/**
 * @public
 */
export type setDOMAttr = (value: unknown, attrs: MutableAttrs) => void;

/**
 * @public
 */
export interface CellAttributes {
  /**
   * The attribute's default value.
   */
  default: unknown;

  /**
   * A function to read the attribute's value from a DOM node.
   */
  getFromDOM?: getFromDOM;

  /**
   * A function to add the attribute's value to an attribute
   * object that's used to render the cell's DOM.
   */
  setDOMAttr?: setDOMAttr;
}

/**
 * @public
 */
export interface TableNodesOptions {
  /**
   * A group name (something like `"block"`) to add to the table
   * node type.
   */
  tableGroup?: string;

  /**
   * The content expression for table cells.
   */
  cellContent: string;

  /**
   * Additional attributes to add to cells. Maps attribute names to
   * objects with the following properties:
   */
  cellAttributes: { [key: string]: CellAttributes };
}

/**
 * @public
 */
export type TableNodes = Record<
  'table' | 'table_row' | 'table_cell' | 'table_header',
  NodeSpec
>;

/**
 * This function creates a set of [node
 * specs](http://prosemirror.net/docs/ref/#model.SchemaSpec.nodes) for
 * `table`, `table_row`, and `table_cell` nodes types as used by this
 * module. The result can then be added to the set of nodes when
 * creating a schema.
 *
 * @public
 */
export function tableNodes(options: TableNodesOptions): TableNodes {
  // const extraRowAttrs = options.rowAttributes || {};
  const rowAttrs: Record<string, AttributeSpec> = {
    rowheight: { default: null },
  };
  
  const extraAttrs = options.cellAttributes || {};
  const cellAttrs: Record<string, AttributeSpec> = {
    colspan: { default: 1 },
    rowspan: { default: 1 },
    colwidth: { default: null },
    rowheight: { default: null },
  };
  for (const prop in extraAttrs)
    cellAttrs[prop] = { default: extraAttrs[prop].default };

  return {
    table: {
      content: 'table_row+',
      tableRole: 'table',
      isolating: true,
      group: options.tableGroup,
      parseDOM: [{ tag: 'table' }],
      toDOM() {
        return ['table', ['tbody', 0]];
      },
    },
    table_row: {
      content: '(table_cell | table_header)*',
      attrs: rowAttrs,
      tableRole: 'row',
      parseDOM: [
        { tag: 'tr', getAttrs: (dom) => getRowAttrs(dom, {}) },
      ],
      toDOM(node) {
        return ['tr', setRowAttrs(node, {}), 0];
      },
    },
    table_cell: {
      content: options.cellContent,
      attrs: cellAttrs,
      tableRole: 'cell',
      isolating: true,
      parseDOM: [
        { tag: 'td', getAttrs: (dom) => getCellAttrs(dom, extraAttrs) },
      ],
      toDOM(node) {
        return ['td', setCellAttrs(node, extraAttrs), 0];
      },
    },
    table_header: {
      content: options.cellContent,
      attrs: cellAttrs,
      tableRole: 'header_cell',
      isolating: true,
      parseDOM: [
        { tag: 'th', getAttrs: (dom) => getCellAttrs(dom, extraAttrs) },
      ],
      toDOM(node) {
        return ['th', setCellAttrs(node, extraAttrs), 0];
      },
    },
  };
}

/**
 * @public
 */
export type TableRole = 'table' | 'row' | 'cell' | 'header_cell';

/**
 * @public
 */
export function tableNodeTypes(schema: Schema): Record<TableRole, NodeType> {
  let result = schema.cached.tableNodeTypes;
  if (!result) {
    result = schema.cached.tableNodeTypes = {};
    for (const name in schema.nodes) {
      const type = schema.nodes[name],
        role = type.spec.tableRole;
      if (role) result[role] = type;
    }
  }
  return result;
}
