// @ts-ignore no @types :(
import PostalMime from "postal-mime";
import { ThrottledQueue } from '@jahands/msc-utils'
import { EmbedQueueData, Env } from './types'

export default {
	async queue(batch: MessageBatch<EmbedQueueData>, env: Env, ctx: ExecutionContext) {
		// Extract the body from each message.
		// Metadata is also available, such as a message id and timestamp.
		for (const message of batch.messages) {
			await sendDiscordEmbed(message.body, env, ctx)
		}
	},
};

// It's 2048 or something, but let's just be safe
const DISCORD_EMBED_LIMIT = 2000
// This may be higher if your server is boosted to level 2, it should be 50MB. If your server is boosted to level 3, it should be 100MB.
const DISCORD_FILE_LIMIT = 8000000

async function sendDiscordEmbed(message: EmbedQueueData, env: Env, ctx: ExecutionContext) {
	const rawEmail = await env.R2EMAILS.get(message.r2path)
	if (!rawEmail) {
		throw new Error('Unable to get raw email from R2!!')
	}
	try {
		const arrayBuffer = await rawEmail.arrayBuffer()
		const parser = new PostalMime()
		const email = await parser.parse(arrayBuffer)
		const embedBody = JSON.stringify({
			embeds: [
				{
					title: `${message.subject}`,
					description:
						email.text.length > DISCORD_EMBED_LIMIT
							? `${email.text.substring(
								0,
								DISCORD_EMBED_LIMIT - 12
							)}...(TRIMMED)`
							: email.text,
					author: {
						name: message.from,
					},
					footer: {
						text: `This email was sent to ${message.to}`,
					},
				},
			],
		})
		const formData = new FormData()
		formData.append("payload_json", embedBody)
		if (email.text.length > DISCORD_EMBED_LIMIT) {
			const newTextBlob = new Blob([email.text], {
				type: "text/plain",
			})
			// If the text is too big, we need truncate the blob.
			if (newTextBlob.size < DISCORD_FILE_LIMIT) {
				formData.append("files[0]", newTextBlob, "email.txt")
			} else {
				formData.append(
					"files[0]",
					newTextBlob.slice(0, DISCORD_FILE_LIMIT, "text/plain"),
					"email-trimmed.txt"
				)
			}
		}
		const hook = await getDiscordWebhook(message.from, env)
		const discordResponse = await fetch(hook, {
			method: "POST",
			body: formData,
		})
		if (!discordResponse.ok) {
			console.log("Discord Webhook Failed")
			console.log(
				`Discord Response: ${discordResponse.status} ${discordResponse.statusText}`
			)
			if (discordResponse.status === 429) {
				const body = await discordResponse.json() as { retry_after: number | undefined }
				console.log(body)
				if (body.retry_after) {
					console.log('sleeping...')
					await sleep(body.retry_after * 1000)
					// retry
					await fetch(await getDiscordWebhook(message.from, env), {
						method: "POST",
						body: formData,
					})
				}
			}
		}
		// You probably will want to forward the mail anyway to an address, in case discord is down,
		// Or you could make it fail if the webhook fails, causing the sending mail server to error out.
		// Or you could do something more complex with adding it to a Queue and retrying sending to Discord, etc
		// For now, I don't really care about those conditions
	} catch (e) {
		console.log('error!', e)
	}
}

// get ready for a big hack for how I'm rate-limiting per webhook here...
const newQueue = () => new ThrottledQueue({ concurrency: 1, interval: 1000, limit: 1 });
const defaultQueue = newQueue()
const githubQueue = newQueue()
const disqusQueue = newQueue()
async function getDiscordWebhook(from: string, env: Env): Promise<string> {
	let hook = env.DISCORDHOOK
	if (from === 'noreply@github.com') {
		await githubQueue.add(async () => { })
		hook = env.GITHUBHOOK
	} else if (from === 'notifications@disqus.net') {
		await disqusQueue.add(async () => { })
		hook = env.DISQUSHOOK
	} else {
		await defaultQueue.add(async () => { })
	}
	return hook
}

function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}