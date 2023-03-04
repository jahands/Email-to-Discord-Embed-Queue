import { Env } from "./types"
import { getSentry } from "./utils"

/** logtail sends logs to logtail.com */
export function logtail(args: {
	env: Env,
	ctx: ExecutionContext,
	msg: string,
	level?: LogLevel,
	data?: any,
	e?: Error
}) {
	let { env, ctx, msg, level, data, e } = args
	if (!data) data = {}

	const sentry = getSentry(env, ctx)
	sentry.setExtra('data', data)
	if (level) sentry.setExtra('level', level)
	sentry.setExtra('msg', msg)

	if (e) {
		sentry.captureException(e, {
			data: {
				msg,
				...data
			}
		})
		data.error = e
	} else {
		sentry.captureMessage(msg, level || LogLevel.Info, { data })
	}
	ctx.waitUntil(fetch("https://in.logtail.com",
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${env.LOGTAIL_KEY}`
			},
			body: JSON.stringify({
				dt: new Date().toISOString(),
				level: level || LogLevel.Info,
				message: msg,
				env: env.ENVIRONMENT,
				...data
			})
		}))
}

export enum LogLevel {
	Debug = "debug",
	Info = "info",
	Warn = "warning",
	Error = "error",
	Fatal = "fatal",
	Log = "log"
}
