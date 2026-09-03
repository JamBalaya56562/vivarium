function unescapeTemplate(s: string): string {
  return s.replace(/\\([\s\S])/g, (_, c) => {
    switch (c) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case '\\':
        return '\\';
      case '`':
        return '`';
      case '$':
        return '$';
      default:
        return c;
    }
  });
}

export function extractTemplateLiteral(
  src: string,
  name: string,
): string | null {
  const re = new RegExp(
    `const\\s+${name}\\s*=\\s*(String\\.raw)?\\s*\`([\\s\\S]*?)\``,
    'm',
  );
  const m = src.match(re);
  if (!m) return null;
  const isRaw = !!m[1];
  const raw = m[2] ?? '';
  return (isRaw ? raw : unescapeTemplate(raw)).trim();
}

export function extractReproSource(reproTs: string): string | null {
  return (
    extractTemplateLiteral(reproTs, 'REPRO_CODE') ??
    extractTemplateLiteral(reproTs, 'REPRO_SOURCE_HINT')
  );
}
