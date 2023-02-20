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
