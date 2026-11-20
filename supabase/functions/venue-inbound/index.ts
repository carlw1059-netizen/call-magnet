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
	// Copied exactly from send-missed-call-sms lines 60–121.
	// Only change: "send-missed-call-sms" → "venue-inbound" in sigUrl.
	const rawBody = await req.text();
	const twilioSig = req.headers.get("X-Twilio-Signature") ?? "";
	console.log("SMSDIAG-1 twilioSig:", JSON.stringify(twilioSig));
	console.log("SMSDIAG-2 req.url:", req.url);
	console.log(
		"SMSDIAG-3 REQUEST_URL env:",
		Deno.env.get("REQUEST_URL") ?? "NOT_SET",
	);
	console.log("SMSDIAG-4 content-type:", req.headers.get("content-type"));
	console.log("SMSDIAG-5 rawBody first 300:", rawBody.substring(0, 300));
	const sigUrl = `${SUPABASE_URL}/functions/v1/venue-inbound${new URL(req.url).search}`;
	const keyBytes = new TextEncoder().encode(TWILIO_AUTH_TOKEN);
	const msgBytes = new TextEncoder().encode(sigUrl);
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		keyBytes,
		{ name: "HMAC", hash: "SHA-1" },
		false,
		["sign"],
	);
	const sigBuffer = await crypto.subtle.sign("HMAC", cryptoKey, msgBytes);
	const expectedSig = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));
	console.log(
		"SMSDIAG-7 sigUrl:",
		sigUrl,
		"| expectedSig:",
		expectedSig,
		"| twilioSig:",
		twilioSig,
		"| match:",
		expectedSig === twilioSig,
	);
	if (expectedSig !== twilioSig) {
		console.warn("venue-inbound: invalid Twilio signature");
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
	console.log(
		"SMSDIAG-6 bodyHash computed:",
		bodyHashHex,
		"| claimed:",
		claimedHash,
		"| match:",
		bodyHashHex === claimedHash,
	);
	if (bodyHashHex !== claimedHash) {
		console.warn("venue-inbound: body hash mismatch — rejecting");
		return new Response(JSON.stringify({ error: "unauthorized" }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});
	}

	// ── 2. PARSE TWILIO PARAMS ────────────────────────────────────────────────
	const params = new URLSearchParams(rawBody);
	const From = params.get("From") ?? "";
	const To = params.get("To") ?? "";
	const ForwardedFrom = params.get("ForwardedFrom") ?? "";
	const CallSid = params.get("CallSid") ?? "";

	console.log(
		`venue-inbound: From=${From} To=${To} ForwardedFrom=${ForwardedFrom} CallSid=${CallSid}`,
	);

	// ── 3. CLIENT LOOKUP ──────────────────────────────────────────────────────
	const clientRes = await fetch(
		`${SUPABASE_URL}/rest/v1/clients` +
			`?twilio_number=eq.${encodeURIComponent(To)}` +
			`&is_test_account=eq.false&account_status=eq.active` +
			`&select=id,venue_router_enabled,studio_voice_url,venue_menu_text,venue_manager_number,forwarded_from,customer_sms_template,middle_man_enabled,middle_man_slug,sms_included,is_test_account,account_status` +
			`&limit=1`,
		{
			headers: {
				apikey: SUPABASE_SERVICE_ROLE_KEY,
				Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
			},
		},
	);

	if (!clientRes.ok) {
		console.warn(`venue-inbound: client lookup HTTP error ${clientRes.status}`);
		return twiml("<Response><Reject/></Response>");
	}

	const clients = (await clientRes.json()) as {
		id: string;
		venue_router_enabled: boolean;
		studio_voice_url: string | null;
		venue_menu_text: string | null;
		venue_manager_number: string | null;
		forwarded_from: string | null;
		customer_sms_template: string | null;
		middle_man_enabled: boolean;
		middle_man_slug: string | null;
		sms_included: number;
		is_test_account: boolean;
		account_status: string;
	}[];

	if (clients.length === 0) {
		console.log(`venue-inbound: no active client for To=${To}`);
		return twiml("<Response><Reject/></Response>");
	}

	const client = clients[0];

	// ── 4. TOGGLE CHECK ───────────────────────────────────────────────────────
	if (!client.venue_router_enabled) {
		console.log(
			`venue-inbound: venue_router_enabled=false for client_id=${client.id}`,
		);
		if (client.studio_voice_url) {
			return twiml(
				`<Response><Redirect>${escXml(client.studio_voice_url)}</Redirect></Response>`,
			);
		}
		return twiml("<Response><Reject/></Response>");
	}

	// ── 5. ANONYMOUS DETECTION ────────────────────────────────────────────────
	const isAnonymous =
		!From ||
		From.toLowerCase() === "anonymous" ||
		From.toLowerCase().startsWith("blocked");

	if (isAnonymous) {
		await fetch(`${SUPABASE_URL}/rest/v1/sms_events`, {
			method: "POST",
			headers: {
				apikey: SUPABASE_SERVICE_ROLE_KEY,
				Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
				"Content-Type": "application/json",
				Prefer: "return=minimal",
			},
			body: JSON.stringify({
				client_id: client.id,
				customer_number: "anonymous",
				client_number: To,
				received_at: new Date().toISOString(),
				twilio_call_sid: CallSid,
				line_type: "anonymous",
			}),
		});
		return twiml("<Response><Reject/></Response>");
	}

	// ── 6. TWO-STATE CLI DETECTION ────────────────────────────────────────────
	// State 1: ForwardedFrom present → real caller is ForwardedFrom
	// State 2: ForwardedFrom absent → carrier stripped CLI, treat all as landline
	const hasForwardedFrom = !!ForwardedFrom;
	const callerNumber = hasForwardedFrom ? ForwardedFrom : From;

	// ── 7. TWILIO LOOKUP (State 1 only) ───────────────────────────────────────
	let detectedType: string = "landline"; // default if State 2 or Lookup fails

	if (hasForwardedFrom) {
		try {
			const lookupRes = await fetch(
				`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(ForwardedFrom)}?Fields=line_type_intelligence`,
				{
					headers: {
						Authorization:
							"Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
					},
				},
			);
			if (lookupRes.ok) {
				const lookupData = (await lookupRes.json()) as {
					line_type_intelligence?: { type?: string };
				};
				detectedType = lookupData.line_type_intelligence?.type ?? "mobile";
			} else {
				console.warn(
					`venue-inbound: Lookup non-200 ${lookupRes.status} — treating as mobile`,
				);
				detectedType = "mobile";
			}
		} catch (e) {
			console.warn("venue-inbound: Lookup threw — treating as mobile", e);
			detectedType = "mobile";
		}
	}

	console.log(
		`venue-inbound: callerNumber=${callerNumber} detectedType=${detectedType} hasForwardedFrom=${hasForwardedFrom}`,
	);

	// ── 8. MOBILE PATH ────────────────────────────────────────────────────────
	if (detectedType === "mobile") {
		const clientId = client.id;
		const smsTo = callerNumber;
		const smsFrom = To;
		let sendSms = true;

		// OPT-OUT CHECK — copied exactly from send-missed-call-sms
		const optRes = await fetch(
			`${SUPABASE_URL}/rest/v1/opt_outs` +
				`?client_id=eq.${encodeURIComponent(clientId)}` +
				`&phone_number=eq.${encodeURIComponent(smsTo)}` +
				`&select=id&limit=1`,
			{
				headers: {
					apikey: SUPABASE_SERVICE_ROLE_KEY,
					Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
				},
			},
		);
		if (!optRes.ok) {
			console.error(
				`venue-inbound: opt_out check failed (HTTP ${optRes.status}) — aborting to avoid texting opted-out number`,
			);
			return twiml("<Response><Reject/></Response>");
		}
		const optOuts = (await optRes.json()) as { id: string }[];
		if (optOuts.length > 0) {
			console.log(
				`venue-inbound: SMS suppressed — to=${smsTo} is opted out for client=${clientId}`,
			);
			sendSms = false;
		}

		// SMS CAP CHECK — copied exactly from send-missed-call-sms (line_type=is.null preserved)
		if (sendSms) {
			const smsIncluded =
				typeof client.sms_included === "number" ? client.sms_included : 50;
			const monthStart = new Date(
				Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
			).toISOString();
			const capRes = await fetch(
				`${SUPABASE_URL}/rest/v1/sms_events` +
					`?client_id=eq.${encodeURIComponent(clientId)}` +
					`&received_at=gte.${encodeURIComponent(monthStart)}` +
					`&line_type=is.null` +
					`&select=id`,
				{
					method: "HEAD",
					headers: {
						apikey: SUPABASE_SERVICE_ROLE_KEY,
						Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
						Prefer: "count=exact",
					},
				},
			);
			if (capRes.ok) {
				const contentRange = capRes.headers.get("content-range") || "*/0";
				const slash = contentRange.lastIndexOf("/");
				const smsCount = parseInt(
					slash >= 0 ? contentRange.slice(slash + 1) : "0",
					10,
				);
				if (Number.isFinite(smsCount) && smsCount >= smsIncluded) {
					console.log(
						`venue-inbound: SMS cap reached for client_id=${clientId} (${smsCount}/${smsIncluded} this month)`,
					);
					sendSms = false;
				}
			}
		}

		// BUILD MESSAGE
		const template = client.customer_sms_template ?? "";
		const linkUrl = "https://cm1.au/" + (client.middle_man_slug ?? "");
		const finalMessage = template.replace(/\[LINK\]/gi, linkUrl);

		// SEND SMS — fire and forget
		if (sendSms) {
			void fetch(
				`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
				{
					method: "POST",
					headers: {
						Authorization:
							"Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
						"Content-Type": "application/x-www-form-urlencoded",
					},
					body: new URLSearchParams({
						From: smsFrom,
						To: smsTo,
						Body: finalMessage,
					}).toString(),
				},
			);
		}

		// LOG TO sms_events — always, before returning TwiML
		await fetch(`${SUPABASE_URL}/rest/v1/sms_events`, {
			method: "POST",
			headers: {
				apikey: SUPABASE_SERVICE_ROLE_KEY,
				Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
				"Content-Type": "application/json",
				Prefer: "return=minimal",
			},
			body: JSON.stringify({
				client_id: client.id,
				customer_number: smsTo,
				client_number: To,
				received_at: new Date().toISOString(),
				twilio_call_sid: CallSid,
				line_type: "mobile",
				message_body: sendSms ? finalMessage : null,
				forwarded_from: ForwardedFrom,
			}),
		});

		return twiml("<Response><Reject/></Response>");
	}

	// ── 9. LANDLINE PATH (includes voip and State 2) ──────────────────────────
	const menuText =
		client.venue_menu_text ??
		"You have reached a business that is currently unavailable. Press 1 to leave a callback request.";

	const keypressUrl = `${SUPABASE_URL}/functions/v1/venue-keypress`;

	// LOG TO sms_events — before returning TwiML
	await fetch(`${SUPABASE_URL}/rest/v1/sms_events`, {
		method: "POST",
		headers: {
			apikey: SUPABASE_SERVICE_ROLE_KEY,
			Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
			"Content-Type": "application/json",
			Prefer: "return=minimal",
		},
		body: JSON.stringify({
			client_id: client.id,
			customer_number: From,
			client_number: To,
			received_at: new Date().toISOString(),
			twilio_call_sid: CallSid,
			line_type: "landline",
			forwarded_from: ForwardedFrom || null,
		}),
	});

	return twiml(
		`<Response><Gather numDigits="1" action="${escXml(keypressUrl)}" method="POST">` +
			`<Say language="en-AU">${escXml(menuText)}</Say>` +
			`</Gather></Response>`,
	);

	// ── 10. CATCH-ALL ─────────────────────────────────────────────────────────
	return twiml("<Response><Reject/></Response>");
});

function twiml(xml: string): Response {
	return new Response(xml, {
		headers: { "Content-Type": "text/xml" },
		status: 200,
	});
}

function escXml(s: string): string {
	return s.replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			]!,
	);
}
