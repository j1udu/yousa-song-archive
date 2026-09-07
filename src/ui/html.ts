/** 极简模板工具：插值默认转义，只有 Raw 才按 HTML 输出。 */
export class Raw {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export type HtmlValue = Raw | string | number | boolean | null | undefined | HtmlValue[];

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

export function raw(value: string): Raw {
  return new Raw(value);
}

function toHtml(value: HtmlValue): string {
  if (value instanceof Raw) return value.value;
  if (value === null || value === undefined || typeof value === "boolean") return "";
  if (Array.isArray(value)) return value.map(toHtml).join("");
  return escapeHtml(String(value));
}

export function html(strings: TemplateStringsArray, ...values: HtmlValue[]): Raw {
  let out = strings[0] ?? "";
  for (let index = 0; index < values.length; index += 1) out += toHtml(values[index]) + (strings[index + 1] ?? "");
  return new Raw(out);
}

export function setHtml(element: Element, content: Raw): void {
  element.innerHTML = content.value;
}

export function query<T extends Element>(scope: ParentNode, selector: string): T {
  const element = scope.querySelector<T>(selector);
  if (!element) throw new Error(`找不到元素：${selector}`);
  return element;
}
