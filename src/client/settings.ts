/**
 * @dsh-external/ui-prompt-optimizer — settings section.
 * Renders the optimization-model and reasoning-effort controls for the
 * `settings.section` seat, loading and saving them through the host's own
 * settings API. The durable document lives on the Host; this page keeps a
 * browser mirror only so the form paints the last known values immediately.
 */
import React, { useEffect, useState } from 'react'

const API_PREFIX = '/@dsh-external/ui-prompt-optimizer/api'
const CONFIG_URL = `${API_PREFIX}/config`
const MODELS_URL = `${API_PREFIX}/models`

/** Browser mirror key of the Host-owned settings document. */
export const CACHE_KEY = 'dsh-external/ui-prompt-optimizer/config'

/** One explicit provider/model route. */
interface ModelRef {
  /** Provider route key. */
  provider: string
  /** Provider-owned model id. */
  model: string
}

/** The settings document this page edits. */
interface OptimizerConfig {
  /** Optimization route, or `null` to follow the default model selection. */
  model: ModelRef | null
  /** Reasoning effort id, or `null` to follow the effective model's default. */
  reasoningEffort: string | null
}

/** One selectable reasoning level. */
interface EffortOption {
  id: string
  name: string
  description?: string
}

/** One selectable model. */
interface ModelOption {
  id: string
  name: string
  description?: string
  efforts: EffortOption[]
  defaultEffort?: string
}

/** One provider route with its models. */
interface ProviderOption {
  id: string
  name: string
  models: ModelOption[]
}

interface ConfigResponse {
  config: OptimizerConfig
  defaults: OptimizerConfig
  selection: (ModelRef & { reasoningEffort?: string }) | null
  storage: boolean
}

/** What each reasoning level costs in latency and buys in quality. */
const EFFORT_HELP: Record<string, string> = {
  off: '不发送思考参数，由服务商自行决定：最快、最省 token，复杂提示词的改写质量可能下降。',
  minimal: '最小推理量：几乎不影响响应速度，适合把一句话说清楚。',
  low: '低强度：响应快、成本低，适合简短或结构简单的提示词。',
  medium: '中强度：速度与质量均衡，日常提示词的首选。',
  high: '高强度：先推理再改写，质量更好，但延迟与 token 消耗明显上升。',
  xhigh: '超高强度：适合多约束、长上下文的复杂提示词，代价进一步上升。',
  max: '最高强度：模型投入最多推理，质量上限最高，也最慢、最贵。',
}

const FOLLOW_LABEL = '跟随模型默认'

function helpOf(effort: EffortOption): string {
  return EFFORT_HELP[effort.id] ?? effort.description ?? '该档位由模型提供。'
}

/** The route the current draft settings would run on. */
function effectiveRef(config: OptimizerConfig, selection: ConfigResponse['selection']): ModelRef | undefined {
  if (config.model !== null) return config.model
  return selection === null ? undefined : { provider: selection.provider, model: selection.model }
}

function routeKey(ref: ModelRef): string {
  return `${ref.provider}\u0000${ref.model}`
}

function findModel(providers: ProviderOption[], ref: ModelRef | undefined): { provider: ProviderOption; model: ModelOption } | undefined {
  if (ref === undefined) return undefined
  const provider = providers.find(entry => entry.id === ref.provider)
  const model = provider?.models.find(entry => entry.id === ref.model)
  return provider === undefined || model === undefined ? undefined : { provider, model }
}

function readCache(): OptimizerConfig | undefined {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (raw === null) return undefined
    const parsed = JSON.parse(raw) as OptimizerConfig
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    // A blocked or unreadable store only costs the first-paint shortcut.
    return undefined
  }
}

function writeCache(config: OptimizerConfig): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(config))
  } catch {
    // The Host document remains authoritative when the mirror cannot be written.
  }
}

async function readJson(response: Response): Promise<any> {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; text: string } | { kind: 'failed'; text: string }

/**
 * The prompt-optimizer settings page.
 * @returns the section markup.
 */
export function PromptOptimizerSection(): React.ReactElement {
  const [loading, setLoading] = useState(true)
  const [storage, setStorage] = useState(true)
  const [providers, setProviders] = useState<ProviderOption[]>([])
  const [selection, setSelection] = useState<ConfigResponse['selection']>(null)
  const [saved, setSaved] = useState<OptimizerConfig>(() => readCache() ?? { model: null, reasoningEffort: null })
  const [config, setConfig] = useState<OptimizerConfig>(() => readCache() ?? { model: null, reasoningEffort: null })
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    let live = true
    const load = async (): Promise<void> => {
      try {
        const [configResponse, modelsResponse] = await Promise.all([fetch(CONFIG_URL), fetch(MODELS_URL)])
        if (!live) return
        if (!configResponse.ok) throw new Error(`加载设置失败（HTTP ${configResponse.status}）`)
        const configBody = await readJson(configResponse) as ConfigResponse
        const modelsBody = await readJson(modelsResponse) as { providers?: ProviderOption[] }
        if (!live) return
        setProviders(modelsBody.providers ?? [])
        setSelection(configBody.selection ?? null)
        setStorage(configBody.storage !== false)
        setSaved(configBody.config)
        setConfig(configBody.config)
        writeCache(configBody.config)
        setError(undefined)
      } catch (failure) {
        if (!live) return
        setError(failure instanceof Error ? failure.message : String(failure))
      } finally {
        if (live) setLoading(false)
      }
    }
    void load()
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (status.kind !== 'saved' && status.kind !== 'failed') return
    const timer = window.setTimeout(() => setStatus({ kind: 'idle' }), 3000)
    return () => window.clearTimeout(timer)
  }, [status])

  const effective = effectiveRef(config, selection)
  const resolved = findModel(providers, effective)
  const levels: { id: string | null; name: string; help: string }[] = [
    {
      id: null,
      name: FOLLOW_LABEL,
      help: resolved?.model.defaultEffort === undefined
        ? '不指定思考参数，由服务商决定；模型没有声明默认档时等同于不发送。'
        : `使用 ${resolved.provider.name}/${resolved.model.name} 声明的默认档：${resolved.model.defaultEffort}。`,
    },
    ...(resolved?.model.efforts ?? []).map(effort => ({ id: effort.id, name: effort.name, help: helpOf(effort) })),
  ]
  const activeLevel = levels.find(level => level.id === config.reasoningEffort) ?? levels[0]
  const dirty = JSON.stringify(config) !== JSON.stringify(saved)
  const currentModelLabel = resolved === undefined
    ? (effective === undefined ? '未配置任何默认模型' : `${effective.provider}/${effective.model}`)
    : `${resolved.provider.name} · ${resolved.model.name}`

  const save = async (): Promise<void> => {
    setStatus({ kind: 'saving' })
    try {
      const response = await fetch(CONFIG_URL, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(config),
      })
      const body = await readJson(response)
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `保存失败（HTTP ${response.status}）`)
      setSaved(body.config)
      setConfig(body.config)
      writeCache(body.config)
      setStatus({ kind: 'saved', text: '设置已保存' })
    } catch (failure) {
      setStatus({ kind: 'failed', text: failure instanceof Error ? failure.message : String(failure) })
    }
  }

  const reset = async (): Promise<void> => {
    setStatus({ kind: 'saving' })
    try {
      const response = await fetch(CONFIG_URL, { method: 'DELETE' })
      const body = await readJson(response)
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `恢复失败（HTTP ${response.status}）`)
      setSaved(body.config)
      setConfig(body.config)
      writeCache(body.config)
      setStatus({ kind: 'saved', text: '已恢复默认设置' })
    } catch (failure) {
      setStatus({ kind: 'failed', text: failure instanceof Error ? failure.message : String(failure) })
    }
  }

  // Switching models drops an effort the new route does not offer, so the page
  // never submits a level the host would refuse.
  const onModelChange = (value: string): void => {
    const nextModel: ModelRef | null = value === ''
      ? null
      : (() => {
        const [provider, model] = value.split('\u0000')
        return { provider, model }
      })()
    const nextRef = nextModel ?? (selection === null ? undefined : { provider: selection.provider, model: selection.model })
    const supported = findModel(providers, nextRef)?.model.efforts.map(effort => effort.id) ?? []
    const kept = config.reasoningEffort !== null && supported.includes(config.reasoningEffort)
      ? config.reasoningEffort
      : null
    setConfig({ model: nextModel, reasoningEffort: kept })
  }

  return React.createElement(
    'div',
    { className: 'dspo' },
    React.createElement('h2', { className: 'dspo-title' }, '提示词优化'),
    React.createElement('p', { className: 'dspo-intro' },
      '配置「优化提示词」按钮使用的模型与思考强度。设置保存在部署侧，作用于所有会话与浏览器。'),

    loading ? React.createElement('p', { className: 'dspo-loading' }, '正在加载设置…') : null,
    error === undefined ? null : React.createElement('p', { className: 'dspo-error' }, error),
    !storage && !loading
      ? React.createElement('p', { className: 'dspo-error' }, '此部署未挂载存储服务，设置只能读取，无法保存。')
      : null,

    React.createElement(
      'section',
      { className: 'dspo-group' },
      React.createElement('div', { className: 'dspo-group-head' },
        React.createElement('h3', { className: 'dspo-group-title' }, '优化模型'),
        React.createElement('p', { className: 'dspo-group-desc' }, '选择执行提示词改写的模型。默认跟随「模型选择」里的默认模型。'),
      ),
      React.createElement('label', { className: 'dspo-field' },
        React.createElement('span', { className: 'dspo-label' }, '模型'),
        React.createElement(
          'select',
          { className: 'dspo-select', value: config.model === null ? '' : routeKey(config.model), onChange: event => onModelChange(event.target.value), disabled: loading },
          React.createElement('option', { value: '' }, `跟随默认模型选择${selection === null ? '' : `（${selection.provider}/${selection.model}）`}`),
          providers.map(provider => React.createElement(
            'optgroup',
            { key: provider.id, label: provider.name },
            provider.models.map(model => React.createElement(
              'option',
              { key: routeKey({ provider: provider.id, model: model.id }), value: routeKey({ provider: provider.id, model: model.id }) },
              `${model.name}（${provider.id}/${model.id}）`,
            )),
          )),
        ),
      ),
      React.createElement('p', { className: 'dspo-help' }, `当前使用：${currentModelLabel}`),
    ),

    React.createElement(
      'section',
      { className: 'dspo-group' },
      React.createElement('div', { className: 'dspo-group-head' },
        React.createElement('h3', { className: 'dspo-group-title' }, '思考强度'),
        React.createElement('p', { className: 'dspo-group-desc' }, '控制优化时的推理深度。档位由所选模型提供，强度越高改写质量越好，但更慢、更耗 token。'),
      ),
      React.createElement(
        'div',
        { className: 'dspo-segmented', role: 'radiogroup', 'aria-label': '思考强度' },
        levels.map(level => React.createElement(
          'button',
          {
            key: level.id ?? 'follow',
            type: 'button',
            role: 'radio',
            'aria-checked': level.id === config.reasoningEffort,
            className: `dspo-seg${level.id === config.reasoningEffort ? ' is-active' : ''}`,
            disabled: loading,
            onClick: () => setConfig({ ...config, reasoningEffort: level.id }),
          },
          level.name,
        )),
      ),
      React.createElement('p', { className: 'dspo-help' }, `${activeLevel.name}：${activeLevel.help}`),
      React.createElement('ul', { className: 'dspo-levels' },
        levels.map(level => React.createElement(
          'li',
          { key: level.id ?? 'follow', className: 'dspo-level' },
          React.createElement('b', null, level.name),
          ` — ${level.help}`,
        )),
      ),
    ),

    React.createElement(
      'div',
      { className: 'dspo-actions' },
      React.createElement('button', { type: 'button', className: 'dspo-btn is-primary', onClick: () => void save(), disabled: loading || !storage || status.kind === 'saving' || !dirty }, status.kind === 'saving' ? '保存中…' : '保存设置'),
      React.createElement('button', { type: 'button', className: 'dspo-btn', onClick: () => void reset(), disabled: loading || !storage || status.kind === 'saving' }, '恢复默认'),
      status.kind === 'saved' ? React.createElement('span', { className: 'dspo-toast is-ok' }, status.text) : null,
      status.kind === 'failed' ? React.createElement('span', { className: 'dspo-toast is-bad' }, status.text) : null,
    ),
  )
}
