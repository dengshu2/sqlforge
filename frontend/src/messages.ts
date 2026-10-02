/** Turns sqlglot's parse errors into short Chinese sentences. The original
 * text is kept alongside, since it often names the exact token. */

import type { ApiError } from './api';

const RULES: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^Expecting (.+)$/, (m) => `这里应该有 ${m[1]}`],
  [/^Invalid expression \/ Unexpected token/, () => '这里有无法识别的写法'],
  [/^Unexpected token/i, () => '这里有多余或无法识别的符号'],
  [/^Error tokenizing/, () => '有没闭合的引号、括号或注释'],
  [/^No SQL statement found/, () => '没有找到 SQL 语句'],
  [/^Required keyword: '(\w+)' missing for (\w+)/, (m) => `${m[2]} 少了必需的部分（${m[1]}）`],
  [/^SQL is nested too deeply/, () => '嵌套层数太多，没法解析'],
  [/^sql: String should have at most/, () => 'SQL 超过 100,000 字符的上限'],
];

export interface ErrorText {
  /** "第 3 行第 14 列：这里应该有 )" */
  text: string;
  /** sqlglot's own wording, when the text above is a translation of it. */
  original: string | null;
  line: number | null;
}

export function describeError(err: ApiError): ErrorText {
  const pos = err.positions[0];
  const detail = err.message;
  let text = detail;
  for (const [re, say] of RULES) {
    const m = re.exec(detail);
    if (m) {
      text = say(m);
      break;
    }
  }
  const line = pos?.line ?? null;
  const where = line ? `第 ${line} 行${pos?.col ? `第 ${pos.col} 列` : ''}：` : '';
  return { text: where + text, original: text === detail ? null : detail, line };
}
