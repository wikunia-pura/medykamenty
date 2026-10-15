// Today's (or a given moment's) calendar date in the machine's local time zone,
// as YYYY-MM-DD. `toISOString().slice(0, 10)` gives the UTC date instead, which
// in Poland is yesterday between midnight and 01:00/02:00.
export function localDateIso(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
