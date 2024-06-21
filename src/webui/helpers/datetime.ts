export function unixtimeToDatetimeLocal(unixtime: number): string {
  if (unixtime === undefined) return "";
  var date = new Date(unixtime * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0,16);
}

export function datetimeLocalToUnixtime(timestring: string): number {
  let ret: number = undefined;
  if (timestring?.length > 0) ret = (new Date(timestring)).getTime() / 1000;
  if (Number.isNaN(ret)) ret = undefined;
  return ret;
}

export function formatDate(
  unixtime: number,
  dateFormat: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
): string {
const date: Date = new Date(unixtime*1000);
const dateText =
  date.toLocaleDateString(window.navigator.language, dateFormat) + " " +
  date.toLocaleTimeString(window.navigator.language);
return dateText;
}