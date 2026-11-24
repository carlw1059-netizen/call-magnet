// send-client-notification: push via OneSignal REST API (replaces VAPID + Progressier).
// Auth: shared-secret via X-Internal-Secret header.
// Events: missed_call | booking_logged | link_tapped

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("INTERNAL_SECRET");
const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID");
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY");

interface ClientRow {
	id: string;
	business_name: string;
	email: string;
	vertical: string;
	avg_job_value: number | null;
}

type EventName = "missed_call" | "booking_logged" | "link_tapped";

function templateFor(
	event: EventName,
	vertical: string,
	ctx: Record<string, unknown>,
): { title: string; body: string } {
	const v =
		vertical === "barber" || vertical === "restaurant" ? vertical : "default";
	const customerName =
		typeof ctx.customer_name === "string" && ctx.customer_name.trim()
			? ctx.customer_name.trim()
			: "New customer";
	if (event === "missed_call") {
		if (v === "barber")
			return {
				title: "💇 Missed call captured",
				body: "Booking SMS sent automatically — check your dashboard",
			};
		if (v === "restaurant")
			return {
				title: "🍽️ Missed call captured",
				body: "Reservation SMS sent automatically — check your dashboard",
			};
		return {
			title: "📞 Missed call captured",
			body: "SMS sent automatically — check your dashboard",
		};
	}
	if (v === "barber")
		return {
			title: "💇 Booking logged",
			body: `${customerName} — added to your bookings`,
		};
	if (v === "restaurant")
		return {
			title: "🍽️ Reservation logged",
			body: `${customerName} — added to your reservations`,
		};
	return {
		title: "✅ Booking logged",
		body: `${customerName} — added to your bookings`,
	};
}

async function sendOneSignalPush(opts: {
	externalUserIds: string[];
	title: string;
	body: string;
}): Promise<{ ok: boolean; status: number; responseText: string }> {
	if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
		return {
			ok: false,
			status: 0,
			responseText: "OneSignal keys not configured",
		};
	}
	const res = await fetch("https://api.onesignal.com/notifications", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Key ${ONESIGNAL_REST_API_KEY}`,
		},
		body: JSON.stringify({
			app_id: ONESIGNAL_APP_ID,
			include_aliases: { external_id: opts.externalUserIds },
			target_channel: "push",
			headings: { en: opts.title },
			contents: { en: opts.body },
			url: "https://app.callmagnet.com.au",
		}),
	});
	const responseText = await res.text();
	return { ok: res.ok, status: res.status, responseText };
}

Deno.serve(async (req) => {
	if (new URL(req.url).searchParams.get("warmup") === "1") {
		return new Response(JSON.stringify({ warmup: "ok" }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}
	if (req.method !== "POST")
		return new Response("Method Not Allowed", { status: 405 });

	try {
		if (!INTERNAL_SECRET)
			return json(500, {
				error: "config_error",
				detail: "INTERNAL_SECRET not configured",
			});
		if (req.headers.get("X-Internal-Secret") !== INTERNAL_SECRET)
			return json(401, { error: "unauthorized" });

		if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
			console.error(
				"send-client-notification: OneSignal keys missing from Vault",
			);
			fetch(`${SUPABASE_URL}/functions/v1/send-pushover-alert`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Internal-Secret": INTERNAL_SECRET,
					Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
				},
				body: JSON.stringify({
					title: "⚠️ OneSignal keys missing",
					message:
						"ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY not set in Vault.",
					priority: 1,
				}),
			}).catch(() => {});
		}

		const rawBody = (await req.json().catch(() => null)) as {
			client_id?: unknown;
			event?: unknown;
			context?: unknown;
		} | null;
		if (!rawBody || typeof rawBody !== "object")
			return json(400, { error: "invalid_body", detail: "JSON body required" });

		const clientId =
			typeof rawBody.client_id === "string" ? rawBody.client_id.trim() : "";
		const event = typeof rawBody.event === "string" ? rawBody.event : "";
		const context =
			typeof rawBody.context === "object" && rawBody.context !== null
				? (rawBody.context as Record<string, unknown>)
				: {};

		if (!clientId)
			return json(400, {
				error: "missing_required_field",
				detail: "client_id is required",
			});
		if (
			event !== "missed_call" &&
			event !== "booking_logged" &&
			event !== "link_tapped"
		) {
			return json(400, {
				error: "invalid_event",
				detail: "event must be missed_call, booking_logged, or link_tapped",
			});
		}

		// missed_call: no push — phone already shows the missed call
		if (event === "missed_call") {
			return json(200, {
				sent: false,
				skipped: "missed_call_notifications_off",
				event: "missed_call",
				client_id: clientId,
			});
		}

		// lookup client
		const clientRes = await fetch(
			`${SUPABASE_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,business_name,email,vertical,avg_job_value`,
			{
				headers: {
					apikey: SUPABASE_SERVICE_ROLE_KEY,
					Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
				},
			},
		);
		if (!clientRes.ok)
			throw new Error(
				`client_lookup_failed: ${clientRes.status} ${await clientRes.text()}`,
			);
		const clientArr = (await clientRes.json()) as ClientRow[];
		if (clientArr.length === 0)
			return json(404, {
				error: "client_not_found",
				detail: `no client with id ${clientId}`,
			});
		const client = clientArr[0];

		if (event === "link_tapped") {
			const pushTitle =
				typeof context.push_title === "string" ? context.push_title.trim() : "";
			const pushMessage =
				typeof context.push_message === "string"
					? context.push_message.trim()
					: "";
			if (!pushTitle || !pushMessage)
				return json(200, {
					sent: false,
					reason: "no_override",
					event,
					client_id: clientId,
				});
			const staffId =
				typeof context.staff_id === "string" && context.staff_id.trim()
					? context.staff_id.trim()
					: null;
			const externalIds = staffId ? [staffId] : [clientId];
			const result = await sendOneSignalPush({
				externalUserIds: externalIds,
				title: pushTitle,
				body: pushMessage,
			});
			if (result.ok) {
				logNotification({
					client_id: clientId,
					channel: "push",
					event: "link_tapped",
					status: "sent",
					provider_response: { status: result.status },
					metadata: {
						title: pushTitle,
						body: pushMessage,
						routed_to: externalIds,
					},
				});
				return json(200, {
					sent: true,
					event: "link_tapped",
					path: "onesignal",
					client_id: clientId,
				});
			} else {
				logNotification({
					client_id: clientId,
					channel: "push",
					event: "link_tapped",
					status: "failed",
					error_message: result.responseText,
					provider_response: { status: result.status },
				});
				fetch(`${SUPABASE_URL}/functions/v1/send-pushover-alert`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"X-Internal-Secret": INTERNAL_SECRET!,
						Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
					},
					body: JSON.stringify({
						title: "⚠️ Push failed",
						message: `${client.business_name} — link_tapped — OneSignal ${result.status}: ${result.responseText}`,
					}),
				}).catch(() => {});
				return json(200, {
					sent: false,
					reason: "onesignal_error",
					status: result.status,
					event,
					client_id: clientId,
				});
			}
		}

		// booking_logged
		const { title, body: msg } = templateFor(
			event as EventName,
			client.vertical,
			context,
		);
		const result = await sendOneSignalPush({
			externalUserIds: [clientId],
			title,
			body: msg,
		});
		if (result.ok) {
			logNotification({
				client_id: clientId,
				channel: "push",
				event,
				status: "sent",
				provider_response: { status: result.status },
				metadata: { title, body: msg },
			});
		} else {
			logNotification({
				client_id: clientId,
				channel: "push",
				event,
				status: "failed",
				error_message: result.responseText,
				provider_response: { status: result.status },
			});
			fetch(`${SUPABASE_URL}/functions/v1/send-pushover-alert`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Internal-Secret": INTERNAL_SECRET!,
					Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
				},
				body: JSON.stringify({
					title: "⚠️ Push failed",
					message: `${client.business_name} — ${event} — OneSignal ${result.status}: ${result.responseText}`,
				}),
			}).catch(() => {});
		}

		return json(200, {
			ok: true,
			push_sent: result.ok ? 1 : 0,
			push_failed: result.ok ? 0 : 1,
			email_sent: false,
		});
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		console.error(`send-client-notification fatal: ${errMsg}`);
		return json(500, { error: "internal_error", detail: errMsg });
	}
});

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function logNotification(row: {
	client_id: string;
	channel: "push" | "email";
	event: string;
	status: "sent" | "failed" | "skipped";
	error_message?: string | null;
	provider_response?: unknown;
	metadata?: unknown;
}): void {
	fetch(`${SUPABASE_URL}/rest/v1/notifications_sent`, {
		method: "POST",
		headers: {
			apikey: SUPABASE_SERVICE_ROLE_KEY,
			Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
			"Content-Type": "application/json",
			Prefer: "return=minimal",
		},
		body: JSON.stringify({
			client_id: row.client_id,
			channel: row.channel,
			event: row.event,
			status: row.status,
			error_message: row.error_message ?? null,
			provider_response: row.provider_response ?? null,
			metadata: row.metadata ?? null,
		}),
	})
		.then(async (res) => {
			if (!res.ok) {
				const body = await res.text().catch(() => "<no body>");
				console.error(
					`notifications_sent insert non-2xx: ${res.status} ${body}`,
				);
			}
		})
		.catch((err) =>
			console.error(
				`notifications_sent insert network error: ${err?.message ?? err}`,
			),
		);
}
