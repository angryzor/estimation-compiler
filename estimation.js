const yaml = require('js-yaml')
const fs = require('fs')
const util = require('util')
const { groupBy, concat, map, flatten, flowRight, compact } = require('lodash/fp')
const cartesian = require('cartesian-product')
const leftPad = require('left-pad')
const argv = require('yargs').argv

const doc = yaml.safeLoad(fs.readFileSync(argv._[0], 'utf8'))

/*
 * Merging nodes
 */
const mergeNodeArrays = flowRight(
  map(group => group.reduce(mergeNodes, {})),
  groupBy(node => node.name),
  flatten,
  compact
)

const mergeNodes = (node, other) =>
  Object.assign({}, node, other, {
    all: node.all == null && other.all == null ? undefined : mergeNodeArrays([node.all, other.all]),
    one_of: node.one_of == null && other.one_of == null ? undefined : mergeNodeArrays([node.one_of, other.one_of]),
  })

/*
 * Resolving extend statement by lookup in library
 */
const resolveExtend = (node, library) =>
  node.extend == null ? node : mergeNodes(resolveExtend(library[node.extend], library), node)

/*
 * Building result tree nodes
 */
const buildSumParent = (node, results) => ({
  name: node.name,
  min: results.reduce((acc, { min }) => acc + min, 0),
  max: results.reduce((acc, { max }) => acc + max, 0),
  children: results,
})

const buildBoundingParent = (node, results) => ({
  name: node.name,
  min: results.reduce((acc, { min }) => Math.min(acc, min), +Infinity),
  max: results.reduce((acc, { max }) => Math.max(acc, max), -Infinity),
  children: results,
})

const buildLeaf = (node) => Object.assign({}, node, {
  children: []
})

/*
 * Determine node type
 */
const NODE_TYPE = {
  ALL: 0,
  ONE_OF: 1,
  LEAF: 2,
}

const nodeType = (node) => {
  if (node.all != null) {
    return NODE_TYPE.ALL
  } else if (node.one_of != null) {
    return NODE_TYPE.ONE_OF
  } else if (node.min != null && node.max != null) {
    return NODE_TYPE.LEAF
  } else {
    throw new Error('Invalid schema...\n' + util.inspect(node))
  }
}

/*
 * Compilers.
 */
const localLibrary = (node, parentLibrary) =>
  Object.assign({}, parentLibrary, node.library || {})

const compileNode = (strategy, node, parentLibrary = {}) => {
  const library = localLibrary(node, parentLibrary)
  const fullNode = resolveExtend(node, library)
  const processNodes = (nodes) => nodes.map(node => compileNode(strategy, node, library))

  return strategy(processNodes, fullNode)
}

const compressive = (processNodes, fullNode) => {
  switch (nodeType(fullNode)) {
    case NODE_TYPE.ALL:
      return buildSumParent(fullNode, processNodes(fullNode.all))
    case NODE_TYPE.ONE_OF:
      return buildBoundingParent(fullNode, processNodes(fullNode.one_of))
    case NODE_TYPE.LEAF:
      return buildLeaf(fullNode)
  }
}

const expansive = (processNodes, fullNode) => {
  switch (nodeType(fullNode)) {
    case NODE_TYPE.ALL:
      return cartesian(processNodes(fullNode.all)).map(results => buildSumParent(fullNode, results))
    case NODE_TYPE.ONE_OF:
      return flatten(processNodes(fullNode.one_of)).map(result => buildSumParent(fullNode, [result]))
    case NODE_TYPE.LEAF:
      return [buildLeaf(fullNode)]
  }
}

const output = (result, padding = '') => {
  console.log(`${leftPad(result.min.toFixed(2), 8)} ${leftPad(result.max.toFixed(2), 8)} | ${padding}${result.name}`)
  result.children.map(e => output(e, padding + '  '))
}

console.log('Compressed summary ')
console.log('---------------------')
console.log('     min      max | text')
output(compileNode(compressive, doc))

compileNode(expansive, doc).map((result, i) => {
  console.log('');
  console.log('Simulation ' + i)
  console.log('-----------------')
  console.log('     min      max | text')
  output(result)
})
