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
