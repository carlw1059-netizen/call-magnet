const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET_FAILED");
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const internalSecret = Deno.env.get("INTERNAL_SECRET");

async function json(status: number, body: unknown): Promise<Response> {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

Deno.serve(async (req) => {
	if (!webhookSecret) {
		console.error(
			"stripe-payment-failed: STRIPE_WEBHOOK_SECRET_FAILED not set",
		);
		return json(500, { error: "misconfigured" });
	}

	const sig = req.headers.get("stripe-signature");
	if (!sig) return json(400, { error: "missing stripe-signature" });

	const body = await req.text();

	// HMAC-SHA256 verification
	const sigMatch = sig.match(/t=(\d+),v1=([a-f0-9]+)/);
	if (!sigMatch) return json(400, { error: "invalid stripe-signature" });

	const webhookTimestamp = parseInt(sigMatch[1], 10);
	if (Math.abs(Date.now() / 1000 - webhookTimestamp) > 300) {
		return json(400, { error: "timestamp too old" });
	}

	const signedPayload = `${sigMatch[1]}.${body}`;
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(webhookSecret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const computedSigBuffer = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(signedPayload),
	);
	const computedSig = Array.from(new Uint8Array(computedSigBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	if (computedSig !== sigMatch[2]) {
		return json(400, { error: "signature mismatch" });
	}

	let event: { type: string; data: { object: Record<string, unknown> } };
	try {
		event = JSON.parse(body);
	} catch {
		return json(400, { error: "invalid JSON" });
	}

	if (event.type !== "invoice.payment_failed") {
		return json(200, { received: true, skipped: event.type });
	}

	const invoice = event.data.object;
	const stripeCustomerId = invoice.customer as string;
	if (!stripeCustomerId) {
		return json(400, { error: "missing customer id" });
	}

	// Fetch client
	const clientRes = await fetch(
		`${supabaseUrl}/rest/v1/clients?stripe_customer_id=eq.${stripeCustomerId}&select=id,business_name,account_status,email`,
		{
			headers: {
				apikey: supabaseKey,
				Authorization: `Bearer ${supabaseKey}`,
			},
		},
	);
	if (!clientRes.ok) {
		console.error(
			`stripe-payment-failed: client lookup failed ${clientRes.status}`,
		);
		return json(500, { error: "client lookup failed" });
	}
	const clients = (await clientRes.json()) as {
		id: string;
		business_name: string;
		account_status: string;
		email: string;
	}[];
	if (!clients.length) {
		console.warn(
			`stripe-payment-failed: no client for stripe_customer_id=${stripeCustomerId}`,
		);
		return json(200, { received: true, skipped: "no_client" });
	}
	const client = clients[0];

	// Skip test accounts
	if (client.account_status === "test") {
		return json(200, { received: true, skipped: "test_account" });
	}

	// Suspend account
	const patchRes = await fetch(
		`${supabaseUrl}/rest/v1/clients?id=eq.${client.id}`,
		{
			method: "PATCH",
			headers: {
				apikey: supabaseKey,
				Authorization: `Bearer ${supabaseKey}`,
				"Content-Type": "application/json",
				Prefer: "return=minimal",
			},
			body: JSON.stringify({ account_status: "suspended" }),
		},
	);
	if (!patchRes.ok) {
		console.error(
			`stripe-payment-failed: suspend PATCH failed ${patchRes.status}`,
		);
		return json(500, { error: "suspend failed" });
	}
	console.log(
		`stripe-payment-failed: suspended account for ${client.business_name} (${client.id})`,
	);

	// Email client: payment failed
	const resendKey = Deno.env.get("RESEND_API_KEY");
	if (resendKey && client.email) {
		const emailRes = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${resendKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from: "CallMagnet <hello@callmagnet.com.au>",
				to: client.email,
				subject: "Action required — payment failed",
				html: `<p>Hi ${client.business_name},</p><p>We were unable to process your latest payment. Your account has been temporarily suspended.</p><p>To restore access, please update your payment details by contacting us at <a href="mailto:hello@callmagnet.com.au">hello@callmagnet.com.au</a>.</p>`,
				text: `Hi ${client.business_name},\n\nWe were unable to process your latest payment. Your account has been temporarily suspended.\n\nTo restore access, please update your payment details by contacting us at hello@callmagnet.com.au.`,
			}),
		}).catch((e: Error) => {
			console.warn(
				`stripe-payment-failed: client email failed — ${e?.message}`,
			);
			return null;
		});
		if (emailRes && !emailRes.ok)
			console.error(
				`stripe-payment-failed: client email failed ${emailRes.status}`,
			);
	}

	// Pushover alert to Carl
	fetch(`${supabaseUrl}/functions/v1/send-pushover-alert`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Internal-Secret": internalSecret ?? "",
		},
		body: JSON.stringify({
			title: "Payment failed",
			message: `Payment failed: ${client.business_name} — account suspended`,
		}),
	}).catch(() => {});

	return json(200, { received: true });
});
