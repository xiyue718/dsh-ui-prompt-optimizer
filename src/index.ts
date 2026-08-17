/**
 * @dsh-external/ui-prompt-optimizer — host half.
 * Exposes POST /@dsh-external/ui-prompt-optimizer/api/optimize so the browser
 * button can rewrite the unsent draft through the configured model.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from 'cordis'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

export const name = '@dsh-external/ui-prompt-optimizer'
export const inject = ['webServer', 'llm', 'agentDefaultModel']

const OPTIMIZE_PATH = '/@dsh-external/ui-prompt-optimizer/api/optimize'
const SYSTEM_PROMPT = [
  '你是一个提示词优化助手。',
  '请把用户给出的提示词改写得更清晰、具体、可执行，保留原意。',
  '只输出优化后的提示词本身，不要解释，不要加前缀，不要用代码块包裹。',
].join('')

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

export function apply(ctx: Context): void {
  ctx.effect(() => (ctx as any).webServer.register({
    kind: 'prefix',
    path: '/@dsh-external/ui-prompt-optimizer/api',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST' || new URL(req.url ?? '/', 'http://x').pathname !== OPTIMIZE_PATH) {
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
      const selection = (ctx as any).agentDefaultModel?.currentSelection?.()
      if (!selection?.provider || !selection?.model) {
        sendJson(res, 503, { error: 'no default model is configured' })
        return
      }
      try {
        const message = createUserMessage({
          content: [{ type: 'text', text: prompt }],
          source: { kind: 'user' },
        })
        const stream = ctx.llm.stream({
          provider: selection.provider,
          model: selection.model,
          messages: [message],
          system: SYSTEM_PROMPT,
          reasoningEffort: ReasoningEffortId('off'),
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
        const message = error instanceof Error ? error.message : String(error)
        sendJson(res, 500, { error: message })
      }
    },
  }), '@dsh-external/ui-prompt-optimizer: optimize route')
}
