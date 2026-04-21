// services/agent-brain/scripts/build-support-scripts.mjs
/**
 * Generate agents/support/scripts.md from docs/support-bot-scripts.md
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

const SRC = join(REPO_ROOT, 'docs/support-bot-scripts.md');
const DST = join(
  REPO_ROOT,
  'services/agent-brain/src/chatAssistant/agents/support/scripts.md'
);

const src = readFileSync(SRC, 'utf8');
const lines = src.split('\n');

const output = [];
output.push('# Скрипты ответов для support-агента (выжимка)');
output.push('');
output.push(
  '> Автогенерируется из `docs/support-bot-scripts.md`. ' +
  'Не править вручную — изменения затрёт `npm run build:support-scripts`.'
);
output.push('');

let currentCategory = null;
let keepBlock = false;

const KEEP_SUBHEADERS = new Set([
  '**Шаблон ответа бота:**',
  '**Когда НЕ отвечать автоматически / эскалировать:**',
  '**Как обрабатывать:**',
]);

const KEEP_TOP_SECTIONS = new Set([
  '## Тональность и общий стиль ответов',
  '## Универсальные фразы-связки (микробиблиотека для бота)',
  '## Общие правила автоматической маршрутизации',
]);

const SKIP_TOP_SECTIONS = new Set([
  '## Источник данных',
  '## Анонимизация (техническая заметка для интеграторов бота)',
]);

let keepTopSection = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  if (line.startsWith('## ')) {
    if (SKIP_TOP_SECTIONS.has(line)) {
      keepTopSection = false;
      continue;
    }
    if (KEEP_TOP_SECTIONS.has(line)) {
      keepTopSection = true;
      currentCategory = null;
      output.push(line);
      continue;
    }
    if (line === '## Категории обращений') {
      keepTopSection = false;
      output.push(line);
      output.push('');
      output.push(
        'Ниже — 16 категорий с готовыми шаблонами ответов и критериями эскалации.'
      );
      continue;
    }
    keepTopSection = false;
    continue;
  }

  if (line.startsWith('### ')) {
    currentCategory = line;
    keepBlock = false;
    output.push('');
    output.push('---');
    output.push('');
    output.push(line);
    continue;
  }

  if (currentCategory) {
    if (line.startsWith('**') && line.endsWith('**')) {
      keepBlock = KEEP_SUBHEADERS.has(line);
      if (keepBlock) output.push(line);
      continue;
    }
    if (line === '---') {
      keepBlock = false;
      currentCategory = null;
      continue;
    }
    if (keepBlock) output.push(line);
    continue;
  }

  if (keepTopSection) output.push(line);
}

const collapsed = output.join('\n').replace(/\n{3,}/g, '\n\n');

writeFileSync(DST, collapsed, 'utf8');

const srcLines = src.split('\n').length;
const dstLines = collapsed.split('\n').length;
console.log(`Generated ${DST}`);
console.log(`  source:     ${srcLines} lines`);
console.log(`  output:     ${dstLines} lines`);
console.log(`  reduction:  ${Math.round((1 - dstLines / srcLines) * 100)}%`);
