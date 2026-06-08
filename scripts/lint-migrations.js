#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const migrationsDir = path.join(__dirname, '../supabase/migrations');
if (!fs.existsSync(migrationsDir)) {
  console.error(`Migrations directory not found at: ${migrationsDir}`);
  process.exit(1);
}

const files = fs.readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort();

console.log(`Linting ${files.length} migration files in ${migrationsDir}...`);

const tablesCreated = new Set();
const rlsEnabled = new Set();
const foreignKeys = []; // array of { table, column, referencedTable }
const indexes = new Set(); // set of "table:column"
const tablesWithUpdatedAt = new Set();
const triggersOnTable = new Set(); // set of "table" that have an update trigger

for (const file of files) {
  const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

  // 1. Detect CREATE TABLE public.xxx or xxx
  const createTableRegex = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/gi;
  let match;
  while ((match = createTableRegex.exec(content)) !== null) {
    tablesCreated.add(match[1].toLowerCase());
  }

  // 2. Detect ALTER TABLE xxx ENABLE ROW LEVEL SECURITY
  const rlsRegex = /alter\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s+enable\s+row\s+level\s+security/gi;
  while ((match = rlsRegex.exec(content)) !== null) {
    rlsEnabled.add(match[1].toLowerCase());
  }

  // 3. Detect updated_at columns and inline foreign keys in CREATE TABLE blocks
  const createBlocks = content.split(/create\s+table/i);
  for (let i = 1; i < createBlocks.length; i++) {
    const block = createBlocks[i];
    const tableNameMatch = /^(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/i.exec(block);
    if (!tableNameMatch) continue;
    const tableName = tableNameMatch[1].toLowerCase();

    // Check if updated_at is in this block
    if (/\bupdated_at\b/i.test(block)) {
      tablesWithUpdatedAt.add(tableName);
    }

    // Parse inline foreign keys like: column_name uuid REFERENCES public.table(id)
    const inlineFkRegex = /(\w+)\s+\w+(?:\([^)]+\))?\s+references\s+(?:public\.)?(\w+)/gi;
    let fkMatch;
    while ((fkMatch = inlineFkRegex.exec(block)) !== null) {
      const colName = fkMatch[1].toLowerCase();
      const refTable = fkMatch[2].toLowerCase();
      if (colName !== 'id') {
        foreignKeys.push({ table: tableName, column: colName, referencedTable: refTable });
      }
    }
  }

  // 4. Detect ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY (col) REFERENCES refTable
  const alterFkRegex = /alter\s+table\s+(?:only\s+)?(?:public\.)?(\w+)\s+add\s+constraint\s+\w+\s+foreign\s+key\s*\(([^)]+)\)\s*references\s+(?:public\.)?(\w+)/gi;
  while ((match = alterFkRegex.exec(content)) !== null) {
    const tableName = match[1].toLowerCase();
    const colName = match[2].trim().toLowerCase();
    const refTable = match[3].toLowerCase();
    foreignKeys.push({ table: tableName, column: colName, referencedTable: refTable });
  }

  // 5. Detect CREATE INDEX
  const indexRegex = /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?\w+\s+on\s+(?:public\.)?(\w+)\s*\(([^)]+)\)/gi;
  while ((match = indexRegex.exec(content)) !== null) {
    const tableName = match[1].toLowerCase();
    const columns = match[2].split(',').map(c => c.trim().toLowerCase());
    for (const col of columns) {
      const cleanCol = col.replace(/\([^)]+\)/g, '').trim();
      indexes.add(`${tableName}:${cleanCol}`);
    }
  }

  // 6. Detect trigger creations
  const triggerRegex = /create\s+trigger\s+\w+\s+(?:before|after)\s+update\s+on\s+(?:public\.)?(\w+)/gi;
  while ((match = triggerRegex.exec(content)) !== null) {
    triggersOnTable.add(match[1].toLowerCase());
  }
}

// Validation logic
let errors = [];

// Rule 1: All tables must have RLS enabled
for (const table of tablesCreated) {
  if (table === 'spatial_ref_sys') continue;
  if (!rlsEnabled.has(table)) {
    errors.push(`Table "${table}" was created but Row Level Security (RLS) was never enabled.`);
  }
}

// Rule 2: All foreign keys must have an index
for (const fk of foreignKeys) {
  const key = `${fk.table}:${fk.column}`;
  if (!indexes.has(key)) {
    let hasIndex = false;
    for (const idx of indexes) {
      if (idx.startsWith(`${fk.table}:`)) {
        const idxCol = idx.split(':')[1];
        if (idxCol.includes(fk.column)) {
          hasIndex = true;
          break;
        }
      }
    }
    if (!hasIndex) {
      errors.push(`Foreign key column "${fk.column}" on table "${fk.table}" (referencing "${fk.referencedTable}") does not have an index.`);
    }
  }
}

// Rule 4: updated_at triggers on all tables with updated_at column
for (const table of tablesWithUpdatedAt) {
  if (!triggersOnTable.has(table)) {
    errors.push(`Table "${table}" has an "updated_at" column but no update trigger registered.`);
  }
}

if (errors.length > 0) {
  console.error('\n❌ Migration Linting Failed:');
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
} else {
  console.log('\n✅ Migration Linting Passed! All tables have RLS, FK columns are indexed, and updated_at triggers are registered.');
  process.exit(0);
}
