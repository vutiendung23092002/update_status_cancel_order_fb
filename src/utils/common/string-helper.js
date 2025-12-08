export function toTitleCase(str) {
  if (!str) return "";
  return str.toLowerCase().replace(/(^|\s)\S/g, (char) => char.toUpperCase());
}
