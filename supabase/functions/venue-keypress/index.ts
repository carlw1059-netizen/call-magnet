import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
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
	const sigUrl = `${SUPABASE_URL}/functions/v1/venue-keypress${new URL(req.url).search}`;

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
		console.warn("venue-keypress: invalid Twilio signature");
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
		console.warn("venue-keypress: body hash mismatch");
		return new Response(JSON.stringify({ error: "unauthorized" }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});
	}

	// ── 2. PARSE PARAMS ───────────────────────────────────────────────────────
	const params = new URLSearchParams(rawBody);
	const Digits = params.get("Digits") ?? "";
	const CallSid = params.get("CallSid") ?? "";
	const To = params.get("To") ?? "";

	console.log(`venue-keypress: CallSid=${CallSid} Digits=${Digits} To=${To}`);

	// ── 3. UPDATE sms_events ──────────────────────────────────────────────────
	// Set keypress = Digits on the row that venue-inbound already inserted
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
			body: JSON.stringify({ keypress: Digits }),
		},
	);

	// ── 4. RESPOND WITH TWIML ─────────────────────────────────────────────────
	if (Digits === "1") {
		return twiml(
			`<Response><Say language="en-AU">Thank you. Your callback request has been noted. We will be in touch shortly. Goodbye.</Say><Hangup/></Response>`,
		);
	}

	// Any other key — just hang up silently
	return twiml("<Response><Hangup/></Response>");
});

function twiml(xml: string): Response {
	return new Response(xml, {
		headers: { "Content-Type": "text/xml" },
		status: 200,
	});
}
