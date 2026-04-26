export function cleanAndParseJSON<T>(payload: any): (T & { [key: string]: any }) | null {
  try {
    if (typeof payload === 'string') {
      payload = JSON.parse(payload);
    }
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('Invalid JSON payload');
    }
    return deepClean(payload);
  } catch (error) {
    console.error('Error parsing JSON:', error);
    return null;
  }
}

function deepClean(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(deepClean).filter((item) => item !== null && item !== undefined);
  } else if (typeof obj === 'object' && obj !== null) {
    return Object.entries(obj).reduce(
      (acc, [key, value]) => {
        if (value === null || value === undefined) return acc;
        if (typeof value === 'string') value = value.trim();
        acc[key] = deepClean(value);
        return acc;
      },
      {} as Record<string, any>
    );
  }
  return obj;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>;
    if (typeof e.details === 'string' && e.details.trim() !== '') return e.details;
    if (typeof e.message === 'string' && e.message.trim() !== '') return e.message;
    if (typeof e.code === 'string') return `Database error code: ${e.code}`;
    return JSON.stringify(e);
  }
  return 'An unknown error occurred';
}

export function italyLocalToUtc(dateString: string): string {
  const [datePart, timePart] = dateString.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, secondFraction] = timePart.split(':');
  const [second] = secondFraction.split('.');
  const hourNum = Number(hour);
  const minuteNum = Number(minute);
  const secondNum = Number(second);

  const utcAssumed = new Date(Date.UTC(year, month - 1, day, hourNum, minuteNum, secondNum));

  if (hourNum === 0 && minuteNum === 0 && secondNum === 0) {
    return utcAssumed.toISOString();
  }

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    timeZoneName: 'longOffset'
  }).formatToParts(utcAssumed);

  const tzString = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+01:00';
  const match = tzString.match(/GMT([+-])(\d{2}):(\d{2})/);
  const offsetMinutes = match ? (match[1] === '+' ? 1 : -1) * (parseInt(match[2]) * 60 + parseInt(match[3])) : 60;

  const correctedUtc = new Date(utcAssumed.getTime() - offsetMinutes * 60 * 1000);
  return correctedUtc.toISOString();
}

export function getYearsAfter(inputDate: string, yearsAfter: number = 2): string {
  const formattedDate = inputDate.replace(' ', 'T');
  const date = new Date(formattedDate);
  if (isNaN(date.getTime())) throw new Error('Invalid date format');

  date.setFullYear(date.getFullYear() + yearsAfter);

  const pad = (num: number) => num.toString().padStart(2, '0');
  const year = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const milliseconds = date.getMilliseconds().toString().padStart(3, '0');

  const timezoneOffset = -date.getTimezoneOffset();
  const sign = timezoneOffset >= 0 ? '+' : '-';
  const tzHours = pad(Math.floor(Math.abs(timezoneOffset) / 60));
  const tzMinutes = pad(Math.abs(timezoneOffset) % 60);

  return `${year}-${m}-${d} ${hours}:${minutes}:${seconds}.${milliseconds}${sign}${tzHours}:${tzMinutes}`;
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

export function convertKeysToCamelCase(data: any): any {
  if (Array.isArray(data)) return data.map(convertKeysToCamelCase);
  if (data && typeof data === 'object') {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [snakeToCamel(key), convertKeysToCamelCase(value)]));
  }
  return data;
}
