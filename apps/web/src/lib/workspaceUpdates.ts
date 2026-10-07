// Cross-tab notifications are optional; storage restrictions must never fail a save.
export const workspaceTabId = crypto.randomUUID();
export function workspaceChannel() {
  try {
    return typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel('cash-flow-updates');
  } catch {
    return null;
  }
}
export function notifyWorkspaceUpdate() {
  const channel = workspaceChannel();
  try {
    channel?.postMessage({ type: 'refresh', source: workspaceTabId });
  } catch {
    // Visible pages also poll and refresh on focus.
  } finally {
    channel?.close();
  }
}
