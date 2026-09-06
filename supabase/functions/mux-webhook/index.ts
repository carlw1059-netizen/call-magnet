import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { MuxSync } from 'npm:@mux/sync-engine@0.0.5'
import { queueWorkflowsForEvent } from 'npm:@mux/supabase@0.0.21'
import { createClient } from 'npm:@supabase/supabase-js@2'

const databaseUrl     = Deno.env.get('SUPABASE_DB_URL') || 'postgresql://your-database-url'
const muxWebhookSecret = Deno.env.get('MUX_WEBHOOK_SECRET') || 'your-mux-webhook-secret'
const muxTokenId      = Deno.env.get('MUX_TOKEN_ID') || 'your-mux-token-id'
const muxTokenSecret  = Deno.env.get('MUX_TOKEN_SECRET') || 'your-mux-token-secret'

const muxSync = new MuxSync({
  databaseUrl,
  muxWebhookSecret,
  muxTokenId,
  muxTokenSecret,
  backfillRelatedEntities: false,
  revalidateEntityViaMuxApi: true,
  maxPostgresConnections: 5,
  logger: console
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const body = await req.text()
    const headers = Object.fromEntries(req.headers.entries())

    await muxSync.processWebhook(body, headers)
    await queueWorkflowsForEvent(body, headers)

    // ── On video.asset.ready — update clients table with Mux playback URL ──
    const event = JSON.parse(body)
    if (event.type === 'video.asset.ready') {
      const assetId    = event.data?.id
      const playbackId = event.data?.playback_ids?.[0]?.id

      if (assetId && playbackId) {
        const muxPlaybackUrl = `https://stream.mux.com/${playbackId}.m3u8`

        const { error } = await supabase
          .from('clients')
          .update({
            mux_playback_id:           playbackId,
            middle_man_background_url: muxPlaybackUrl,
            video_processing_status:   'live',
            middle_man_updated_at:     new Date().toISOString(),
          })
          .eq('mux_asset_id', assetId)

        if (error) {
          console.error('Failed to update client with Mux playback URL:', error.message)
        } else {
          console.log(`Client updated with Mux playback URL for asset ${assetId}`)
        }
      }
    }

    return new Response(JSON.stringify({ status: 'success' }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error processing webhook:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
