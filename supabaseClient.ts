import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://your-project-id.supabase.co';
const SUPABASE_KEY = 'your-anon-key';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
