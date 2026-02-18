export interface StatusHistoryEntry {
  [key: string]: string | null | undefined;
  from: string;
  to: string;
  at: string;
  by: string;
  reason?: string | null;
}

/**
 * Extrai o histórico de status existente de uma oportunidade
 * e retorna um novo array com a entrada adicionada
 */
export function appendStatusHistory(
  currentHistory: unknown,
  entry: StatusHistoryEntry,
): StatusHistoryEntry[] {
  const history = (Array.isArray(currentHistory) ? currentHistory : []) as StatusHistoryEntry[];
  return [...history, entry];
}

/**
 * Cria uma entrada de histórico de status
 */
export function createHistoryEntry(
  from: string,
  to: string,
  userId: string,
  reason?: string | null,
): StatusHistoryEntry {
  return {
    from,
    to,
    at: new Date().toISOString(),
    by: userId,
    reason: reason || null,
  };
}
