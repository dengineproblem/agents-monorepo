import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: '.env.agent' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !supabaseServiceRole) {
  console.error('Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE not set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRole, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function applyMigration(migrationFile) {
  console.log('==========================================');
  console.log('Applying Migration to Supabase');
  console.log('==========================================');
  console.log(`File: ${migrationFile}`);
  console.log('');

  const migrationPath = join(__dirname, 'migrations', migrationFile);
  const sql = readFileSync(migrationPath, 'utf8');

  console.log(`📄 Applying ${migrationFile}...`);
  console.log('SQL:', sql.substring(0, 200) + '...');
  console.log('');

  try {
    // Execute the SQL directly
    const { data, error } = await supabase.rpc('exec', { sql });

    if (error) {
      console.error('❌ Error applying migration:', error);
      process.exit(1);
    }

    console.log(`✅ ${migrationFile} applied successfully.`);
    console.log('');
    console.log('==========================================');
    console.log('🎉 Migration applied successfully!');
    console.log('==========================================');
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

// Get migration file from command line argument
const migrationFile = process.argv[2] || '037_add_visual_style_to_carousels.sql';
applyMigration(migrationFile);
