import { z } from "zod"
import { PROTOCOL_VERSION } from "./protocol"

const sourceIdentitySchema = z.object({
  processInstanceId: z.string(),
  pluginInstanceId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  directory: z.string(),
  serverUrl: z.string().url().optional(),
  capabilities: z.array(z.literal("session.write")).optional(),
  openCodeVersion: z.string().optional(),
})

export const heartbeatSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  type: z.literal("heartbeat"),
  sentAt: z.number(),
  source: sourceIdentitySchema,
})

export const sessionStatusChangedSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  type: z.literal("session.status.changed"),
  sentAt: z.number(),
  source: sourceIdentitySchema,
  session: z.object({
    id: z.string(),
    parentId: z.string().optional(),
    title: z.string(),
    agent: z.string().optional(),
    model: z.string().optional(),
    status: z.enum([
      "running",
      "waiting",
      "retrying",
      "idle",
      "failed",
      "stale",
    ]),
    updatedAt: z.number(),
  }),
})

export const sessionDeletedSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  type: z.literal("session.deleted"),
  sentAt: z.number(),
  source: sourceIdentitySchema,
  sessionId: z.string(),
})

export const telemetryMessageSchema = z.discriminatedUnion("type", [
  heartbeatSchema,
  sessionStatusChangedSchema,
  sessionDeletedSchema,
])

export const ingestRequestSchema = z.object({
  messages: z.array(telemetryMessageSchema),
})

export const snapshotSessionSchema = z.object({
  id: z.string(),
  parentId: z.string().optional(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  directory: z.string().optional(),
  title: z.string(),
  agent: z.string().optional(),
  model: z.string().optional(),
  status: z.enum([
    "running",
    "waiting",
    "retrying",
    "idle",
    "failed",
    "stale",
  ]),
  statusKnown: z.boolean().optional(),
  updatedAt: z.number(),
})

export const snapshotRequestSchema = z.object({
  source: sourceIdentitySchema,
  scope: z.enum(["local", "global"]),
  sessions: z.array(snapshotSessionSchema),
})
