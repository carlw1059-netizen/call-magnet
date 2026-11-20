import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
	// ── Warmup ────────────────────────────────────────────────────────────────
	if (new URL(req.url).searchParams.get("warmup") === "1") {
		return new Response(JSON.stringify({ warmup: "ok" }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}

	if (req.method !== "POST") {
		return new Response("Method Not Allowed", { status: 405 });
	}

	// ── 1. HMAC VALIDATION ────────────────────────────────────────────────────
	const rawBody = await req.text();
	const twilioSig = req.headers.get("X-Twilio-Signature") ?? "";
	const sigUrl = `${SUPABASE_URL}/functions/v1/venue-dial-status${new URL(req.url).search}`;

	const keyBytes = new TextEncoder().encode(TWILIO_AUTH_TOKEN);
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		keyBytes,
		{ name: "HMAC", hash: "SHA-1" },
		false,
		["sign"],
	);
	const sigBuffer = await crypto.subtle.sign(
		"HMAC",
		cryptoKey,
		new TextEncoder().encode(sigUrl),
	);
	const expectedSig = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));
	if (expectedSig !== twilioSig) {
		console.warn("venue-dial-status: invalid Twilio signature");
		return new Response(JSON.stringify({ error: "unauthorized" }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});
	}

	const bodyHashBuf = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(rawBody),
	);
	const bodyHashHex = [...new Uint8Array(bodyHashBuf)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	const claimedHash = new URL(req.url).searchParams.get("bodySHA256") ?? "";
	if (bodyHashHex !== claimedHash) {
		console.warn("venue-dial-status: body hash mismatch");
		return new Response(JSON.stringify({ error: "unauthorized" }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});
	}

	// ── 2. PARSE PARAMS ───────────────────────────────────────────────────────
	const params = new URLSearchParams(rawBody);
	const CallSid = params.get("CallSid") ?? "";
	const CallStatus =
		params.get("CallStatus") ?? params.get("DialCallStatus") ?? "";

	console.log(`venue-dial-status: CallSid=${CallSid} CallStatus=${CallStatus}`);

	// ── 3. UPDATE sms_events ──────────────────────────────────────────────────
	if (CallSid) {
		await fetch(
			`${SUPABASE_URL}/rest/v1/sms_events` +
				`?twilio_call_sid=eq.${encodeURIComponent(CallSid)}`,
			{
				method: "PATCH",
				headers: {
					apikey: SUPABASE_SERVICE_ROLE_KEY,
					Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
					"Content-Type": "application/json",
					Prefer: "return=minimal",
				},
				body: JSON.stringify({ dial_status: CallStatus }),
			},
		);
	}

	// ── 4. RESPOND ────────────────────────────────────────────────────────────
	// Twilio status callbacks only need a 200 — no TwiML required
	return new Response("ok", { status: 200 });
});
