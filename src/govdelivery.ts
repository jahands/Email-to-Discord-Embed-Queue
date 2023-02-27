import { LogLevel, logtail } from "./logtail";
import { Env } from "./types";

let govDeliveryStats: Map<string, number>
export function initGovDeliveryStats(): Map<string, number> {
  govDeliveryStats = new Map<string, number>()
  return govDeliveryStats
}

export function getGovDeliveryStats(): Map<string, number> {
  if (!govDeliveryStats) {
    govDeliveryStats = new Map<string, number>()
  }
  return govDeliveryStats
}

export function recordGovDeliveryStats(env: Env, ctx: ExecutionContext): void {
  const stats = getGovDeliveryStats()
  if (stats.size > 0) {
    for (const [id, count] of stats) {
      try {
        if (count > 0) {
          env.GOVDELIVERY.writeDataPoint({
            blobs: [id],
            doubles: [count],
            indexes: [id]
          })
        }
      } catch (e) {
        if (e instanceof Error) {
          logtail({
            env, ctx, e, msg: 'Failed to write to AE: ' + e.message,
            level: LogLevel.Error,
            data: {
              aeDataSet: 'govdelivery',
              govID: id,
              govCount: count,
            }
          })
        }
      }
    }
  }
}

export function getGovDeliveryID(emailText: string): string {
  const match = emailText.match(/https*:\/\/public\.govdelivery\.com\/accounts\/[a-zA-Z_-]+\/subscriber\//g)
  if (!match || match.length === 0) throw new Error('GovDelivery ID not found')
  let prefix = '://public.govdelivery.com/accounts/'
  let id: string | undefined
  try {
    id = match[0].split(prefix)[1].split('/')[0].toUpperCase()
  } catch (e) {
    if (e instanceof Error) {
      throw new Error('GovDelivery ID not found: ' + e.message)
    }
  }
  if (!id || id === '') throw new Error('GovDelivery ID not found')
  return id
}
