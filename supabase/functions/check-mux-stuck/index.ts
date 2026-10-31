import { createClient } from "npm:@supabase/supabase-js@2";

const INTERNAL_SECRET = Deno.env.get("INTERNAL_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

const supabase = createClient(
	SUPABASE_URL,
	Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
	{ auth: { autoRefreshToken: false, persistSession: false } },
);

Deno.serve(async (req) => {
	if (
		req.headers.get("x-internal-secret") !== INTERNAL_SECRET ||
		!INTERNAL_SECRET
	) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
		});
	}

	const { data: stuck, error } = await supabase
		.from("clients")
		.select("id, business_name")
		.eq("video_processing_status", "processing")
		.lt(
			"middle_man_updated_at",
			new Date(Date.now() - 10 * 60 * 1000).toISOString(),
		);

	if (error) {
		console.error("[check-mux-stuck] query error:", error.message);
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
		});
	}

	for (const client of stuck ?? []) {
		fetch(`${SUPABASE_URL}/functions/v1/send-pushover-alert`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Internal-Secret": INTERNAL_SECRET,
			},
			body: JSON.stringify({
				title: "⚠️ Mux stuck",
				message: `⚠️ Mux stuck: ${client.business_name} has been processing for 10+ minutes`,
			}),
		}).catch(() => {});
	}

	return new Response(
		JSON.stringify({ checked: true, stuck: (stuck ?? []).length }),
		{
			headers: { "Content-Type": "application/json" },
		},
	);
});
