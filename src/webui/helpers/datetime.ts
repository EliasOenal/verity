// TODO rename this file to humanreadable.ts or something

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

/**
 * Format bytes as human-readable text.
 *
 * @param bytes Number of bytes.
 * @param si True to use metric (SI) units, aka powers of 1000. False to use
 *           binary (IEC), aka powers of 1024.
 * @param dp Number of decimal places to display.
 * @return Formatted string.
 * @author Mark Penner on Stack Overflow,
 *         https://stackoverflow.com/questions/10420352/converting-file-size-in-bytes-to-human-readable-string
 * @license CC BY-SA 3.0 as per https://stackoverflow.com/help/licensing
 */
export function humanFileSize(bytes: number, si: boolean = false, dp: number = 1) {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return bytes + ' B';
  }

  const units = si
    ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  let u = -1;
  const r = 10**dp;

  do {
    bytes /= thresh;
    ++u;
  } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);


  return bytes.toFixed(dp) + ' ' + units[u];
}
