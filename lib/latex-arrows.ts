/**
 * Convert the common LaTeX arrow fragments models sometimes write into plain
 * Unicode arrows. Deliberately tiny: this is not a LaTeX renderer, and dollar
 * prices such as "$190" are left untouched.
 */
export function convertLatexArrows(text: string): string {
  return text
    .replace(/\$\\rightarrow\$/g, "→")
    .replace(/\$\\to\$/g, "→")
    .replace(/\\rightarrow/g, "→")
    .replace(/\$\\leftarrow\$/g, "←");
}
