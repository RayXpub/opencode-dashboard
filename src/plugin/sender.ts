import type {
  Heartbeat,
  HeartbeatResponse,
  SessionCommandResult,
  SnapshotRequest,
  TelemetryMessage,
} from "../shared/protocol"

type SendOptions = {
  collectorUrl: string
  maxQueueSize: number
  flushIntervalMs: number
}

const DEFAULT_OPTIONS: SendOptions = {
  collectorUrl: `http://127.0.0.1:4747`,
  maxQueueSize: 1000,
  flushIntervalMs: 1000,
}

export class TelemetrySender {
  private queue: TelemetryMessage[] = []
  private options: SendOptions
  private flushTimer: ReturnType<typeof setInterval> | null = null

  constructor(options?: Partial<SendOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  start() {
    if (this.flushTimer) return
    this.flushTimer = setInterval(() => this.flush(), this.options.flushIntervalMs)
  }

  async stop() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    await this.flush()
  }

  enqueue(message: TelemetryMessage) {
    if (this.queue.length >= this.options.maxQueueSize) {
      this.queue.shift()
    }
    this.queue.push(message)
  }

  async sendHeartbeat(heartbeat: Heartbeat): Promise<HeartbeatResponse> {
    const response = await fetch(`${this.options.collectorUrl}/api/v1/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(heartbeat),
    })
    if (!response.ok) {
      throw new Error(`Heartbeat request failed: ${response.status}`)
    }
    return response.json()
  }

  async sendCommandResult(result: SessionCommandResult) {
    await fetch(
      `${this.options.collectorUrl}/api/v1/commands/${encodeURIComponent(result.commandId)}/result`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      },
    )
  }

  async sendSnapshot(snapshot: SnapshotRequest) {
    const response = await fetch(`${this.options.collectorUrl}/api/v1/snapshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    })
    if (!response.ok) {
      throw new Error(`Snapshot request failed: ${response.status}`)
    }
  }

  async flush() {
    if (this.queue.length === 0) return

    const batch = this.queue.splice(0, this.queue.length)

    try {
      const response = await fetch(`${this.options.collectorUrl}/api/v1/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: batch }),
      })

      if (!response.ok) {
        // Re-queue on server error but drop on client error
        if (response.status >= 500) {
          this.queue.unshift(...batch.slice(-this.options.maxQueueSize))
        }
      }
    } catch {
      // Network error; re-queue everything
      this.queue.unshift(...batch.slice(-this.options.maxQueueSize))
    }
  }
}
