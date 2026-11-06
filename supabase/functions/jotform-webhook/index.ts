// jotform-webhook: receives a POST from JotForm when a client agreement form
// is submitted and creates a new row in public.clients.
//
// Auth: X-Jotform-Secret header must match JOTFORM_WEBHOOK_SECRET from Vault.
// Missing or wrong secret → 401.
//
// Body: application/x-www-form-urlencoded (JotForm default webhook format).
// Field mapping:
//   q6_businessName   / q6  → business_name (required)
//   q7_clientName     / q7  → owner_name
//   q8_abn            / q8  → abn
//   q9_businessNumber / q9  → owner_phone
//   q10_bookingUrl    / q10 → booking_url
//   q11_emailAddress  / q11 → email (required)
//
// After a successful insert, fires a Pushover alert (fire-and-forget).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
	if (new URL(req.url).searchParams.get("warmup") === "1") {
		return new Response(JSON.stringify({ warmup: "ok" }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}

	if (req.method !== "POST") {
		return new Response("Method Not Allowed", { status: 405 });
	}

	// Read secrets inside the handler so they are never cached at cold-start
	const JOTFORM_WEBHOOK_SECRET = Deno.env.get("JOTFORM_WEBHOOK_SECRET");
	const INTERNAL_SECRET = Deno.env.get("INTERNAL_SECRET");

	// ── Secret verification ────────────────────────────────────────────────────
	const providedSecret =
		req.headers.get("X-Jotform-Secret") ||
		new URL(req.url).searchParams.get("secret");
	if (!JOTFORM_WEBHOOK_SECRET || providedSecret !== JOTFORM_WEBHOOK_SECRET) {
		return json(401, { error: "unauthorized" });
	}

	// ── Parse form body ────────────────────────────────────────────────────────
	let params: URLSearchParams;
	try {
		const text = await req.text();
		params = new URLSearchParams(text);
		console.log("JOTFORM BODY:", JSON.stringify(Object.fromEntries(params)));
	} catch {
		return json(400, {
			error: "invalid_body",
			detail: "Could not parse form body",
		});
	}

	function field(...names: string[]): string {
		for (const name of names) {
			const v = params.get(name)?.trim() ?? "";
			if (v) return v;
		}
		return "";
	}

	const businessName = field("q6_businessName", "q6");
	const ownerName = field("q7_clientName", "q7");
	const abn = field("q8_abn", "q8");
	const ownerPhone = field("q9_businessNumber", "q9");
	const bookingUrl = field("q10_bookingUrl", "q10");
	const email = field("q11_emailAddress", "q11");

	// ── Required field validation ──────────────────────────────────────────────
	if (!businessName)
		return json(400, {
			error: "missing_required_field",
			detail: "business_name (q6) is required",
		});
	if (!email)
		return json(400, {
			error: "missing_required_field",
			detail: "email (q11) is required",
		});

	console.log(
		`jotform-webhook: contract signed business_name="${businessName}" email="${email}"`,
	);

	// ── Pushover alert (fire-and-forget) ──────────────────────────────────────
	if (INTERNAL_SECRET) {
		try {
			fetch(`${SUPABASE_URL}/functions/v1/send-pushover-alert`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Internal-Secret": INTERNAL_SECRET,
				},
				body: JSON.stringify({
					title: "Contract signed 🖊️",
					message: `${businessName} just signed — onboard them now: https://app.callmagnet.com.au/admin/onboard.html`,
				}),
			}).catch((err: Error) =>
				console.error("jotform-webhook: Pushover failed:", err?.message ?? err),
			);
		} catch {
			// silent
		}
	}

	return json(200, { ok: true });
});

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
