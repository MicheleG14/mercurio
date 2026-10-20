import 'reflect-metadata';
import { parseSort, skipAndTake } from './pagination.js';

describe('pagination helpers', () => {
  it('turns a page into skip and take', () => {
    expect(skipAndTake({ page: 1, pageSize: 25 })).toEqual({ skip: 0, take: 25 });
    expect(skipAndTake({ page: 3, pageSize: 10 })).toEqual({ skip: 20, take: 10 });
  });

  it('accepts only the sort fields a list allows', () => {
    expect(parseSort('at:desc', ['at', 'type'])).toEqual({ field: 'at', direction: 'desc' });
    expect(parseSort('password:asc', ['at', 'type'])).toBeNull();
    expect(parseSort(undefined, ['at'])).toBeNull();
  });
});
