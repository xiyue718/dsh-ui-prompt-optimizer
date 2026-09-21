/**
 * @dsh-external/ui-prompt-optimizer — host half.
 * Owns this deployment's optimization settings behind
 * `GET|PUT|DELETE /@dsh-external/ui-prompt-optimizer/api/config`, offers the
 * selectable models and their reasoning efforts at `/api/models`, and rewrites
 * the unsent draft at `/api/optimize` using whatever is saved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from 'cordis'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

export const name = '@dsh-external/ui-prompt-optimizer'
export const inject = ['webServer', 'llm', 'agentDefaultModel', 'storageDomain']

const API_PREFIX = '/@dsh-external/ui-prompt-optimizer/api'
const CONFIG_PATH = `${API_PREFIX}/config`
const MODELS_PATH = `${API_PREFIX}/models`
const OPTIMIZE_PATH = `${API_PREFIX}/optimize`

/** Row key of the single settings document in the `config` table. */
const CONFIG_ROW = 'default'

const SYSTEM_PROMPT = [
  '你是一个提示词优化助手。',
  '请把用户给出的提示词改写得更清晰、具体、可执行，保留原意。',
  '只输出优化后的提示词本身，不要解释，不要加前缀，不要用代码块包裹。',
].join('')

/** One explicit provider/model route. */
const modelRefSchema = z.object({ provider: z.string(), model: z.string() })

/**
 * Deployment settings of the optimizer. Both fields are nullable: `null` model
 * follows the live `agentDefaultModel` selection, and `null` effort keeps the
 * effective model's own default.
 */
export const configSchema = z.object({
  /** Optimization route, or `null` to follow the default model selection. */
  model: modelRefSchema.nullable(),
  /** Reasoning effort id, or `null` to follow the effective model's default. */
  reasoningEffort: z.string().nullable(),
})
export type PromptOptimizerConfig = z.infer<typeof configSchema>

/** What the deployment serves before anyone saves a choice. */
export const DEFAULT_CONFIG: PromptOptimizerConfig = { model: null, reasoningEffort: null }

/**
 * Persistence identity: domain `dsh_external_prompt_optimizer`, table `config`,
 * single row keyed `default`.
 */
const DOMAIN_SPEC = defineDomain({
  name: 'dsh_external_prompt_optimizer',
  version: 1,
  tables: { config: domainTable<string, PromptOptimizerConfig>(configSchema) },
})

/** One selectable reasoning level of one model. */
interface EffortOption {
  id: string
  name: string
  description?: string
}

/** One selectable model of one provider route. */
interface ModelOption {
  id: string
  name: string
  description?: string
  efforts: EffortOption[]
  defaultEffort?: string
}

/** One provider route with the models it currently serves. */
interface ProviderOption {
  id: string
  name: string
  models: ModelOption[]
}

/** The live default model selection, absent when none is configured. */
interface Selection {
  provider: string
  model: string
  reasoningEffort?: string
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer | string) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The live default model selection the profile boots fresh agents with. */
function currentSelection(ctx: Context): Selection | undefined {
  const selection = (ctx as any).agentDefaultModel?.currentSelection?.()
  if (typeof selection?.provider !== 'string' || selection.provider === '') return undefined
  if (typeof selection?.model !== 'string' || selection.model === '') return undefined
  return {
    provider: selection.provider,
    model: selection.model,
    ...typeof selection.reasoningEffort === 'string' && selection.reasoningEffort !== ''
      ? { reasoningEffort: selection.reasoningEffort }
      : {},
  }
}

/** Resolve one route's model metadata; unknown routes answer `undefined`. */
async function resolveModelInfo(ctx: Context, provider: string, model: string): Promise<LlmResolvedModelInfo | undefined> {
  try {
    return await (ctx as any).llm.resolveModelInfo(provider, model)
  } catch {
    return undefined
  }
}

/** Every registered route with the models it serves and each model's efforts. */
async function listProviders(ctx: Context): Promise<ProviderOption[]> {
  const providers: ProviderOption[] = []
  for (const provider of (ctx as any).llm.listProviders() as { id: string; name: string }[]) {
    let models: LlmModelInfo[]
    try {
      models = await (ctx as any).llm.listModels(provider.id)
    } catch {
      // A route whose catalog cannot be read offers no choices instead of failing the page.
      continue
    }
    const options: ModelOption[] = []
    for (const model of models) {
      const info = await resolveModelInfo(ctx, provider.id, model.id)
      const reasoning = info?.reasoning
      options.push({
        id: model.id,
        name: model.name,
        ...model.description === undefined ? {} : { description: model.description },
        efforts: (reasoning?.efforts ?? []).map(effort => ({
          id: String(effort.id),
          name: effort.name,
          ...effort.description === undefined ? {} : { description: effort.description },
        })),
        ...reasoning?.defaultEffort === undefined ? {} : { defaultEffort: String(reasoning.defaultEffort) },
      })
    }
    providers.push({ id: provider.id, name: provider.name, models: options })
  }
  return providers
}

/** The route and effort one optimization run uses, before validation. */
interface EffectiveRoute {
  provider: string
  model: string
  effort?: string
}

/** Resolve the saved settings onto the route this call runs, or `undefined` without a model. */
function effectiveRoute(config: PromptOptimizerConfig, selection: Selection | undefined): EffectiveRoute | undefined {
  const target = config.model ?? (selection === undefined ? undefined : { provider: selection.provider, model: selection.model })
  if (target === undefined) return undefined
  // A saved effort belongs to the saved model; following the default selection
  // also follows that selection's own effort unless one is saved here.
  const effort = config.reasoningEffort
    ?? (config.model === null ? selection?.reasoningEffort : undefined)
  return { provider: target.provider, model: target.model, ...effort === undefined ? {} : { effort } }
}

/** Read the persisted settings, falling back to defaults for an absent or unreadable row. */
function readConfig(domain: any): PromptOptimizerConfig {
  if (domain === undefined) return { ...DEFAULT_CONFIG }
  let stored: unknown
  try {
    stored = domain.table('config').get(CONFIG_ROW)
  } catch {
    return { ...DEFAULT_CONFIG }
  }
  const parsed = configSchema.safeParse(stored)
  return parsed.success ? parsed.data : { ...DEFAULT_CONFIG }
}

/** Persist one settings document. */
async function writeConfig(domain: any, config: PromptOptimizerConfig): Promise<void> {
  await domain.table('config').put(CONFIG_ROW, config)
}

/**
 * Validate one submitted settings document against the live model catalog.
 * @param ctx - Host context owning the LLM service.
 * @param body - Parsed request body.
 * @returns The accepted settings, or the refusal a person reads.
 */
async function validateConfig(ctx: Context, body: unknown): Promise<{ ok: true; config: PromptOptimizerConfig } | { ok: false; error: string }> {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'the request body must be a JSON object' }
  const candidate = body as { model?: unknown; reasoningEffort?: unknown }

  let model: PromptOptimizerConfig['model'] = null
  if (candidate.model !== null && candidate.model !== undefined) {
    const parsed = modelRefSchema.safeParse(candidate.model)
    if (!parsed.success || parsed.data.provider === '' || parsed.data.model === '') {
      return { ok: false, error: 'model must be null or a non-empty { provider, model } object' }
    }
    if (await resolveModelInfo(ctx, parsed.data.provider, parsed.data.model) === undefined) {
      return { ok: false, error: `unknown model route: ${parsed.data.provider}/${parsed.data.model}` }
    }
    model = parsed.data
  }

  let reasoningEffort: string | null = null
  if (candidate.reasoningEffort !== null && candidate.reasoningEffort !== undefined) {
    if (typeof candidate.reasoningEffort !== 'string' || candidate.reasoningEffort === '') {
      return { ok: false, error: 'reasoningEffort must be null or a non-empty effort id' }
    }
    reasoningEffort = candidate.reasoningEffort
  }

  const route = effectiveRoute({ model, reasoningEffort }, currentSelection(ctx))
  if (reasoningEffort !== null) {
    if (route === undefined) return { ok: false, error: 'no model is available to validate the reasoning effort against' }
    const info = await resolveModelInfo(ctx, route.provider, route.model)
    const allowed = (info?.reasoning?.efforts ?? []).map(effort => String(effort.id))
    if (!allowed.includes(reasoningEffort)) {
      return {
        ok: false,
        error: allowed.length === 0
          ? `${route.provider}/${route.model} exposes no reasoning effort`
          : `reasoningEffort must be one of ${allowed.join(', ')} for ${route.provider}/${route.model}`,
      }
    }
  }
  return { ok: true, config: { model, reasoningEffort } }
}

/** Collect one streamed completion into its text. */
async function collectText(stream: AsyncIterable<StreamChunk>): Promise<string> {
  let text = ''
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') text += chunk.text
    if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
      throw new Error(chunk.reason.failure.message)
    }
  }
  return text.trim()
}

export async function apply(ctx: Context): Promise<void> {
  const storageDomain = (ctx as any).storageDomain
  let domain: any
  if (storageDomain !== undefined) {
    try {
      domain = await storageDomain.open(DOMAIN_SPEC)
      ctx.effect(() => () => { void domain?.close?.() }, '@dsh-external/ui-prompt-optimizer: settings domain')
    } catch (error) {
      // Without a storage backend the page still renders; saving reports the failure.
      ctx.logger.warn('ui-prompt-optimizer: settings storage is unavailable, the page runs read-only', error)
      domain = undefined
    }
  }

  ctx.effect(() => (ctx as any).webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const pathname = new URL(req.url ?? '/', 'http://x').pathname

      if (pathname === CONFIG_PATH && req.method === 'GET') {
        sendJson(res, 200, {
          config: readConfig(domain),
          defaults: { ...DEFAULT_CONFIG },
          selection: currentSelection(ctx) ?? null,
          storage: domain !== undefined,
        })
        return
      }

      if (pathname === MODELS_PATH && req.method === 'GET') {
        try {
          sendJson(res, 200, { providers: await listProviders(ctx) })
        } catch (error) {
          sendJson(res, 500, { error: messageOf(error) })
        }
        return
      }

      if (pathname === CONFIG_PATH && req.method === 'PUT') {
        if (domain === undefined) {
          sendJson(res, 503, { error: 'settings storage is unavailable in this deployment' })
          return
        }
        let body: unknown
        try {
          body = JSON.parse(await readBody(req))
        } catch {
          sendJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        const validated = await validateConfig(ctx, body)
        if (!validated.ok) {
          sendJson(res, 400, { error: validated.error })
          return
        }
        try {
          await writeConfig(domain, validated.config)
          sendJson(res, 200, { ok: true, config: validated.config })
        } catch (error) {
          sendJson(res, 500, { error: messageOf(error) })
        }
        return
      }

      if (pathname === CONFIG_PATH && req.method === 'DELETE') {
        if (domain === undefined) {
          sendJson(res, 503, { error: 'settings storage is unavailable in this deployment' })
          return
        }
        try {
          await writeConfig(domain, { ...DEFAULT_CONFIG })
          sendJson(res, 200, { ok: true, config: { ...DEFAULT_CONFIG } })
        } catch (error) {
          sendJson(res, 500, { error: messageOf(error) })
        }
        return
      }

      if (pathname !== OPTIMIZE_PATH || req.method !== 'POST') {
        sendJson(res, 404, { error: 'not found' })
        return
      }

      let prompt: unknown
      try {
        prompt = JSON.parse(await readBody(req)).prompt
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' })
        return
      }
      if (typeof prompt !== 'string' || prompt.trim() === '') {
        sendJson(res, 400, { error: 'prompt is required' })
        return
      }
      const route = effectiveRoute(readConfig(domain), currentSelection(ctx))
      if (route === undefined) {
        sendJson(res, 503, { error: 'no default model is configured' })
        return
      }
      try {
        const message = createUserMessage({
          content: [{ type: 'text', text: prompt }],
          source: { kind: 'user' },
        })
        const stream = ctx.llm.stream({
          provider: route.provider,
          model: route.model,
          messages: [message],
          system: SYSTEM_PROMPT,
          // An explicit effort is sent only when one is configured: a model
          // without reasoning capability rejects any explicit effort.
          ...route.effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(route.effort) },
          maxTokens: 2048,
          temperature: 0.3,
        })
        const optimized = await collectText(stream)
        if (optimized === '') {
          sendJson(res, 502, { error: 'the model returned an empty prompt' })
          return
        }
        sendJson(res, 200, { optimized })
      } catch (error) {
        // The transport message hides its socket cause; carry it for diagnosis.
        const cause = (error as { cause?: { message?: string } } | null)?.cause?.message
        const message = cause === undefined ? messageOf(error) : `${messageOf(error)} — ${cause}`
        sendJson(res, 500, { error: message })
      }
    },
  }), '@dsh-external/ui-prompt-optimizer: api')
}
