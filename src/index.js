import dotenv from 'dotenv'
dotenv.config()

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

const { data, error } = await supabase
  .from('crisis_logs')
  .select('*')

if (error) {
  console.log('❌ Connection failed:', error.message)
} else {
  console.log('✅ Connected! Data:', data)
}