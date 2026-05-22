// intentional no-op stub; failures are caught by caller in service.ts::safeNotifyStatusChange.
export async function onUserStatusChange(
  _userId: string,
  _newStatus: string,
  _previousStatus: string,
  _reason?: string | null
): Promise<void> {}
