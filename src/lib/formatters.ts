export const fmtMoney = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export const fmtMoney2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const fmtNum = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});

export const fmtPct = (v: number): string => `${(v * 100).toFixed(2)}%`;

export const fmtRatio = (v: number): string => `${v.toFixed(2)}x`;
