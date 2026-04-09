export interface PaginationParams {
  limit: number;
  cursor: string | null;
}

export interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function parsePagination(query: {
  limit?: string | number;
  cursor?: string;
}): PaginationParams {
  let limit = typeof query.limit === 'string' ? parseInt(query.limit, 10) : (query.limit ?? DEFAULT_LIMIT);
  if (isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const cursor = query.cursor && query.cursor.length > 0 ? query.cursor : null;

  return { limit, cursor };
}

export function paginateResults<T extends { id: string }>(
  rows: T[],
  limit: number,
): PaginatedResult<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].id : null;

  return { data, nextCursor, hasMore };
}
