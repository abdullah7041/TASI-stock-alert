import calendar from '../../market_holidays.json' with { type: 'json' };

const recordedHolidays = new Set(calendar.closed);
export function isTradingDate(value, holidays = recordedHolidays) {
  return [0,1,2,3,4].includes(new Date(`${value}T00:00:00Z`).getUTCDay()) && !holidays.has(value);
}
export function previousTradingDate(value, holidays = recordedHolidays) {
  const cursor=new Date(`${value}T00:00:00Z`);
  do cursor.setUTCDate(cursor.getUTCDate()-1); while(!isTradingDate(cursor.toISOString().slice(0,10),holidays));
  return cursor.toISOString().slice(0,10);
}
