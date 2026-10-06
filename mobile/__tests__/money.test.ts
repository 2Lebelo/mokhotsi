import { formatCents, parseToCents, sumCents } from '@/lib/money';

describe('lib/money', () => {
  it('formats integer cents as maloti', () => {
    expect(formatCents(0)).toBe('M0.00');
    expect(formatCents(5)).toBe('M0.05');
    expect(formatCents(4599)).toBe('M45.99');
    expect(formatCents(-1250)).toBe('-M12.50');
  });

  it('rejects non-integer amounts', () => {
    expect(() => formatCents(12.5)).toThrow(TypeError);
  });

  it('parses user input to cents without floating point drift', () => {
    expect(parseToCents('12')).toBe(1200);
    expect(parseToCents('12.5')).toBe(1250);
    expect(parseToCents('M 0.29')).toBe(29);
    expect(parseToCents('12.345')).toBeNull();
    expect(parseToCents('abc')).toBeNull();
  });

  it('sums cents exactly', () => {
    expect(sumCents([10, 20, 70])).toBe(100);
  });
});
