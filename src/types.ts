import { Toucan } from "toucan-js"

export interface Env {
	// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	// MY_KV_NAMESPACE: KVNamespace;
	//
	// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
	// MY_DURABLE_OBJECT: DurableObjectNamespace;
	//
	// Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
	// MY_BUCKET: R2Bucket;
	//
	// Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
	// MY_SERVICE: Fetcher;
	DISCORDHOOK: string
	GITHUBHOOK: string
	DISQUSHOOK: string
	GERRITHOOK: string
	GOOGLEALERTSHOOK: string
	GOVHOOK: string
	BULKHOOK: string
	R2EMAILS: R2Bucket
	BOTTOKEN: string // Discord bot token to improve ratelimits
	EMBEDSTATS: AnalyticsEngineDataset
	GOVDELIVERY: AnalyticsEngineDataset
	ENVIRONMENT: string
	LOGTAIL_KEY: string
	SENTRY_DSN: string
	SENTRY_RELEASE: string
}

/** Synced with https://replit.com/@jachands/Email-Worker-Github#src/types.ts */
export interface EmbedQueueData {
	/** Envelope From attribute of the email message. */
	from: string
	/** Envelope To attribute of the email message. */
	to: string
	/** Subject of email */
	subject: string
	/** Path to raw email in R2 bucket */
	r2path: string
	/** timestamp of the message */
	ts: number
	/** Whether the embed worker should record govDelivery stats */
	shouldCheckGovDelivery: boolean
}
