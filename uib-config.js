// ============================================================
//  UIB BINDER BOOK — where the data lives
//  ------------------------------------------------------------
//  Every page loads this first. To move the data to your own
//  self-hosted Supabase (see SELF-HOST-SETUP.md), change these two
//  values to the tunnel address and that server's anon key, add the
//  address to connect-src in vercel.json, and deploy.
// ============================================================
window.UIB_CONFIG = {
    // Where the AMS lives. It is its own deployment, and this is the one
    // place that says so: the AMS button, the client links out of Your
    // Submissions, and the origin check on the sign-in handover all read
    // it. /ams on this site still serves a copy as a fallback.
    AMS_URL: 'https://uib-ams.vercel.app',

    // Where the Binder Book lives, for the AMS's "← Back to Binder Book"
    // link. It is read at load rather than written into the markup so that
    // ams.html is byte-identical in both repositories — a file that has to
    // be hand-edited on the way across is a file that goes stale.
    BINDER_URL: 'https://uib-binderbook.vercel.app',

    SUPABASE_URL:  'https://jgjmobktucyimupelfxd.supabase.co',
    SUPABASE_ANON: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impnam1vYmt0dWN5aW11cGVsZnhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NDAxMDYsImV4cCI6MjA5ODUxNjEwNn0.5vClAeHl-Cgo6QH4IW3oDHKQn_DKB3DZef9bN9IP0XQ'
};
