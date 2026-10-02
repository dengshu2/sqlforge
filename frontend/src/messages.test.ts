import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { describeError } from './messages';

describe('error wording', () => {
  it('translates and keeps the position and original', () => {
    const e = describeError(new ApiError('Expecting )', 422, [{ line: 3, col: 14, description: 'Expecting )' }]));
    expect(e).toEqual({ text: '第 3 行第 14 列：这里应该有 )', original: 'Expecting )', line: 3 });
  });

  it('passes through what it does not know', () => {
    const e = describeError(new ApiError('Something new', 422));
    expect(e).toEqual({ text: 'Something new', original: null, line: null });
  });
});
