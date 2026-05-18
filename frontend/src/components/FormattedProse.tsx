import { Fragment, type CSSProperties } from 'react';

interface Props {
  text: string;
  style?: CSSProperties;
}

const MONEY = /\$\d+(?:\.\d+)?[KMB]?/g;
const PERCENT = /\b\d+(?:\.\d+)?%/g;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const MONTH_DAY = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?\b/g;
const KEY_TERMS = /\b(?:Demo Day|term sheet|runway|burn|cushion|cash zero|Beta(?: now)?)\b/g;

type Match = { start: number; end: number; kind: 'money' | 'percent' | 'date' | 'term' };

function findMatches(s: string): Match[] {
  const out: Match[] = [];
  const push = (re: RegExp, kind: Match['kind']) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) out.push({ start: m.index, end: m.index + m[0].length, kind });
  };
  push(MONEY, 'money');
  push(PERCENT, 'percent');
  push(ISO_DATE, 'date');
  push(MONTH_DAY, 'date');
  push(KEY_TERMS, 'term');
  out.sort((a, b) => a.start - b.start);
  const merged: Match[] = [];
  for (const m of out) {
    if (merged.length && m.start < merged[merged.length - 1].end) continue;
    merged.push(m);
  }
  return merged;
}

const TOKEN_STYLE: Record<Match['kind'], CSSProperties> = {
  money: { color: '#2A2118', fontWeight: 600 },
  percent: { color: '#D9962B', fontWeight: 600 },
  date: { color: '#2A2118', fontWeight: 600 },
  term: { color: '#2A2118', fontWeight: 600 },
};

function renderLine(line: string, keyPrefix: string) {
  const matches = findMatches(line);
  if (matches.length === 0) return <Fragment key={keyPrefix}>{line}</Fragment>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.start > cursor) parts.push(<Fragment key={`${keyPrefix}-t${i}`}>{line.slice(cursor, m.start)}</Fragment>);
    parts.push(
      <span key={`${keyPrefix}-m${i}`} style={TOKEN_STYLE[m.kind]}>
        {line.slice(m.start, m.end)}
      </span>,
    );
    cursor = m.end;
  });
  if (cursor < line.length) parts.push(<Fragment key={`${keyPrefix}-tail`}>{line.slice(cursor)}</Fragment>);
  return <Fragment key={keyPrefix}>{parts}</Fragment>;
}

function splitSentences(s: string): string[] {
  const trimmed = s.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/(?<=[.!?])\s+(?=["'(]?[A-Z])/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

export default function FormattedProse({ text, style }: Props) {
  const paragraphs = text.split(/\n{2,}/);
  return (
    <div style={style}>
      {paragraphs.map((para, pi) => {
        const lines = para.split('\n').flatMap((l, lineIdx) =>
          splitSentences(l).map((sent, sIdx) => ({ sent, lineIdx, sIdx })),
        );
        return (
          <div key={pi} style={{ marginTop: pi === 0 ? 0 : 8 }}>
            {lines.map((entry, i) => (
              <p
                key={i}
                style={{
                  margin: i === 0 ? 0 : '4px 0 0',
                }}
              >
                {renderLine(entry.sent, `p${pi}-l${i}`)}
              </p>
            ))}
          </div>
        );
      })}
    </div>
  );
}
