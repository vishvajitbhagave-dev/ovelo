/**
 * Remove the most common markdown artifacts models add to otherwise plain
 * answers: stray asterisks and notes wrapped as `*( ... )*`.
 *
 * Real `**bold**` spans, `*` bullet markers and prices such as `$190` are kept.
 */
export function cleanText(text: string): string {
  if (!text) return "";

  let value = text.replace(/\r\n?/g, "\n");

  // Keep inline code exactly as the model wrote it.
  const codes: string[] = [];
  value = value.replace(/`[^`\n]+`/g, (token) => {
    codes.push(token);
    return `\u0000C${codes.length - 1}\u0000`;
  });

  // `*(a short note)*` -> `a short note`
  value = value.replace(/\*\(\s*([^()\n]*?)\s*\)\*/g, "$1");

  // Protect valid bold spans while removing every other asterisk.
  const bolds: string[] = [];
  value = value.replace(/\*\*([^*\n]+)\*\*/g, (_, inner: string) => {
    bolds.push(inner);
    return `\u0000B${bolds.length - 1}\u0000`;
  });

  // A leading `*` followed by whitespace is a bullet, not an artifact.
  value = value
    .split("\n")
    .map((line) => line.replace(/^([ \t]*)\*([ \t]+)/, "$1\u0000S$2"))
    .join("\n");

  value = value.replace(/\*/g, "");
  value = value
    .replace(/\u0000S/g, "*")
    .replace(/\u0000B(\d+)\u0000/g, (_, index: string) => `**${bolds[Number(index)]}**`)
    .replace(/\u0000C(\d+)\u0000/g, (_, index: string) => codes[Number(index)]);

  return value.replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n");
}
