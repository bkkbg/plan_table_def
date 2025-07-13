import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zllfholpgqtqpmdegplu.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsbGZob2xwZ3F0cXBtZGVncGx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAxNDc4MjksImV4cCI6MjA2NTcyMzgyOX0.cfwKaMb7GBQWwVPK5C7Zvwjsd8wP5WxXFOy9dfE4pWk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
