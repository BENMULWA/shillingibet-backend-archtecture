'use strict';

const { once } = require('events');

const escapeCsvCell = (value) => {
  if (value == null) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const csvLine = (values) => `${values.map(escapeCsvCell).join(',')}\r\n`;

const streamCsv = async (res, filename, headers, rows) => {
  res.status(200);
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
  res.flushHeaders();
  res.write('\uFEFF');
  res.write(csvLine(headers));

  for await (const row of rows) {
    if (!res.write(csvLine(row))) await once(res, 'drain');
  }

  res.end();
};

module.exports = { escapeCsvCell, csvLine, streamCsv };
