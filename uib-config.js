// ============================================================
//  UIB BINDER BOOK — where the data lives
//  ------------------------------------------------------------
//  Every page loads this first. To move the data to your own
//  self-hosted Supabase (see SELF-HOST-SETUP.md), change these two
//  values to the tunnel address and that server's anon key, add the
//  address to connect-src in vercel.json, and deploy.
// ============================================================
window.UIB_CONFIG = {
    // Where the AMS lives. It is its own deployment now, but /ams on this
    // site still serves a copy, so that stays the default until the AMS
    // project has its own domain. Point this at that domain (e.g.
    // 'https://ams-uib.vercel.app') and the Binder Book's client links
    // follow it — no other change needed.
    AMS_URL: '/ams',

    SUPABASE_URL:  'https://jgjmobktucyimupelfxd.supabase.co',
    SUPABASE_ANON: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impnam1vYmt0dWN5aW11cGVsZnhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NDAxMDYsImV4cCI6MjA5ODUxNjEwNn0.5vClAeHl-Cgo6QH4IW3oDHKQn_DKB3DZef9bN9IP0XQ'
};
