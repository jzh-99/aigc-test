import type { AppNode, AppEdge } from './types'

/**
 * Detect cycles in the DAG using DFS with a recursion stack.
 * Complexity: O(V + E) — called on every new connection attempt.
 * For very large graphs (>1000 nodes), consider incremental cycle
 * detection that only checks the newly added edge's path.
 */
export function hasCycle(nodes: AppNode[], edges: AppEdge[]): boolean {
  const adjacencyList: Map<string, string[]> = new Map()

  nodes.forEach((n) => adjacencyList.set(n.id, []))
  edges.forEach((e) => {
    if (adjacencyList.has(e.source)) {
      adjacencyList.get(e.source)!.push(e.target)
    }
  })

  const visited: Set<string> = new Set()
  const stack: Set<string> = new Set()

  function dfs(nodeId: string): boolean {
    visited.add(nodeId)
    stack.add(nodeId)

    const neighbors = adjacencyList.get(nodeId) || []
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true
      } else if (stack.has(neighbor)) {
        return true
      }
    }

    stack.delete(nodeId)
    return false
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      if (dfs(node.id)) return true
    }
  }

  return false
}

// 获取某个节点的所有直接上游连线节点 ID
export function getUpstreamNodeIds(nodeId: string, edges: AppEdge[]): string[] {
  return edges.filter((e) => e.target === nodeId).map((e) => e.source)
}

// 获取某个节点的所有直接下游连线节点 ID
export function getDownstreamNodeIds(nodeId: string, edges: AppEdge[]): string[] {
  return edges.filter((e) => e.source === nodeId).map((e) => e.target)
}

// 获取某个节点的所有上游节点 ID（BFS，仅向上游方向遍历）
export function getAllUpstreamNodeIds(nodeId: string, edges: AppEdge[]): Set<string> {
  const visited = new Set<string>()
  const queue = [nodeId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const id of getUpstreamNodeIds(current, edges)) {
      if (!visited.has(id)) {
        visited.add(id)
        queue.push(id)
      }
    }
  }
  return visited
}

// 获取完整的连通分量 (为了高亮或者提取局部依赖)
export function getConnectedComponent(startNodeId: string, edges: AppEdge[]): Set<string> {
  const connected = new Set<string>()
  const queue = [startNodeId]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (!connected.has(current)) {
      connected.add(current)

      const upstream = getUpstreamNodeIds(current, edges)
      const downstream = getDownstreamNodeIds(current, edges)

      queue.push(...upstream.filter((id) => !connected.has(id)))
      queue.push(...downstream.filter((id) => !connected.has(id)))
    }
  }

  return connected
}
