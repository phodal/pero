/** Container policy, independent of the tool View's requested content height. */
export type McpAppSizePolicy = Readonly<{
  initialHeight: number;
  minHeight: number;
  maxHeight: number;
}>;

export const defaultMcpAppSize: McpAppSizePolicy = Object.freeze({
  initialHeight: 480, minHeight: 240, maxHeight: 960,
});

export function mcpAppSizePolicy(value: McpAppSizePolicy): McpAppSizePolicy {
  const {initialHeight, minHeight, maxHeight} = value;
  if (![initialHeight, minHeight, maxHeight].every(Number.isFinite)
    || minHeight < 0 || maxHeight < minHeight || initialHeight < minHeight || initialHeight > maxHeight) {
    throw new Error('MCP App heights must be finite and satisfy 0 ≤ minimum ≤ initial ≤ maximum.');
  }
  return Object.freeze({initialHeight, minHeight, maxHeight});
}

export function mcpAppHeight(policy: McpAppSizePolicy, requested: number): number {
  return Math.min(policy.maxHeight, Math.max(policy.minHeight, requested));
}
