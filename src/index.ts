import { sendDiscordEmbeds } from './discord';
import { logtail, LogLevel } from './logtail';
import { EmbedQueueData, Env } from './types'
import { getDiscordWebhook } from './utils';

export default {
	async queue(batch: MessageBatch<EmbedQueueData>, env: Env, ctx: ExecutionContext) {
		try {
			console.log(`Processing ${batch.messages.length} messages...`)
			// Different webhooks for different senders, so we need to group by webhook
			const messages = batch.messages.map((m) => m.body)
			const messagesByWebhook = {} as Record<string, { data: EmbedQueueData[], name: string }>
			const hookNames = new Map<string, number>()
			for (const msg of messages) {
				const { hook, name } = await getDiscordWebhook(msg.from, env)
				if (!messagesByWebhook[hook]) {
					messagesByWebhook[hook] = { data: [], name }
				}
				messagesByWebhook[hook].data.push(msg)
				hookNames.set(hook, (hookNames.get(hook) || 0) + 1)
			}

			// Send embeds to discord
			for (const webhook of Object.keys(messagesByWebhook)) {
				await sendDiscordEmbeds(
					messagesByWebhook[webhook].data,
					webhook,
					messagesByWebhook[webhook].name,
					env, ctx)
			}
		} catch (e) {
			if (e instanceof Error) {
				await logtail({
					env, msg: e.message,
					level: LogLevel.Error,
					data: {
						error: {
							message: e.message,
							stack: e.stack
						},
					}
				})
			}
		}
	},
};
