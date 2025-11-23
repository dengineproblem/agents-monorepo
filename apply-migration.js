const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: '.env.agent' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !supabaseServiceRole) {
  console.error('Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE not set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRole);

async function applyMigration(migrationFile) {
  console.log('==========================================');
  console.log('Applying Migration to Supabase');
  console.log('==========================================');
  console.log(`File: ${migrationFile}`);
  console.log('');

  const migrationPath = path.join(__dirname, 'migrations', migrationFile);

  if (!fs.existsSync(migrationPath)) {
    console.error(`❌ Migration file not found: ${migrationPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationPath, 'utf8');

  console.log(`📄 Applying ${migrationFile}...`);

  try {
    // Split by semicolons and filter out empty statements
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement) {
        const { data, error } = await supabase.rpc('exec_sql', { sql: statement });

        if (error) {
          console.error(`❌ Error executing statement:`, error);
          console.error(`Statement: ${statement.substring(0, 100)}...`);
          process.exit(1);
        }
      }
    }

    console.log(`✅ ${migrationFile} applied successfully.`);
    console.log('');
    console.log('==========================================');
    console.log('🎉 Migration applied successfully!');
    console.log('==========================================');
  } catch (err) {
    console.error('❌ Error applying migration:', err);
    process.exit(1);
  }
}

// Get migration file from command line argument
const migrationFile = process.argv[2] || '037_add_visual_style_to_carousels.sql';
applyMigration(migrationFile);
