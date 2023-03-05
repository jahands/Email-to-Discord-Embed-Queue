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
    let statsSent = 0
    for (const [id, count] of stats) {
      try {
        if (count > 0) {
          if (statsSent >= 18) { // 24 - 6 (how many channels we have)
            // We better stop or AE will refuse stats
            logtail({
              env, ctx, msg: 'Too many GovDelivery stats to send, stopping',
              level: LogLevel.Warning,
              data: {
                aeDataSet: 'govdelivery',
                stats,
              }
            })
            break
          }
          statsSent++
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
  const match = emailText.match(/https*:\/\/((public\.govdelivery\.com)|(updates\.loc\.gov))\/accounts\/[a-zA-Z_-]+\/subscriber\//g)
  if (!match || match.length === 0) throw new Error('GovDelivery ID not found (match)')

  let prefix = [
    '://public.govdelivery.com/accounts/', '://updates.loc.gov/accounts/'
  ].filter((p) => match[0].includes(p))[0]
  if (!prefix) throw new Error('GovDelivery ID not found (prefix)')

  let id: string | undefined
  try {
    id = match[0].split(prefix)[1].split('/')[0].toUpperCase()
  } catch (e) {
    if (e instanceof Error) {
      throw new Error('GovDelivery ID not found (parse): ' + e.message)
    }
  }
  if (!id || id === '') throw new Error('GovDelivery ID not found (id)')
  return id
}
