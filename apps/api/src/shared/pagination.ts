import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/**
 * Query string of every list (docs/conventions.md B16): `?page=1&pageSize=25&sort=at:desc&q=text`.
 * Each list decides which fields it can sort on and what `q` searches.
 */
export class PageQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;

  /** `field:asc` or `field:desc`. */
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z]+:(asc|desc)$/)
  sort?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** Response of every list. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function skipAndTake({ page, pageSize }: Pick<PageQuery, 'page' | 'pageSize'>) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

/** `at:desc` → `{ field: 'at', direction: 'desc' }`; null when absent or not an allowed field. */
export function parseSort<F extends string>(
  sort: string | undefined,
  allowed: readonly F[],
): { field: F; direction: 'asc' | 'desc' } | null {
  if (!sort) return null;
  const [field, direction] = sort.split(':');
  return (allowed as readonly string[]).includes(field!)
    ? { field: field as F, direction: direction as 'asc' | 'desc' }
    : null;
}
