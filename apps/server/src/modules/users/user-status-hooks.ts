/**
 * Called when a user's account status changes. Add domain-specific side
 * effects here (e.g. suspending resources, revoking access).
 */
export async function onUserStatusChange(
  _userId: string,
  _newStatus: string,
  _previousStatus: string,
  _reason?: string | null
): Promise<void> {}
