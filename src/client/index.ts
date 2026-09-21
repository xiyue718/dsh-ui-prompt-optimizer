/**
 * @dsh-external/ui-prompt-optimizer — browser half.
 * Adds an icon-only button to the composer tool row. Clicking it replaces the
 * unsent draft with an optimized prompt; the same button becomes an undo
 * button that restores the original draft.
 */
import React, { useEffect, useRef, useState } from 'react'
import { PromptOptimizerSection } from './settings.ts'

export const inject = ['slots']

const API_PATH = '/@dsh-external/ui-prompt-optimizer/api/optimize'

type ButtonState = 'idle' | 'loading' | 'optimized'

function Icon({ children, title, style }: { children: React.ReactNode; title: string; style?: React.CSSProperties }) {
  return React.createElement(
    'svg',
    {
      width: 16,
      height: 16,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      role: 'img',
      ...style === undefined ? {} : { style },
    },
    children,
    React.createElement('title', null, title),
  )
}

function OptimizeIcon() {
  return React.createElement(Icon, { title: '优化提示词' },
    React.createElement('path', { d: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z' }),
    React.createElement('path', { d: 'M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z' }),
  )
}

function UndoIcon() {
  return React.createElement(Icon, { title: '撤回优化' },
    React.createElement('path', { d: 'M3 7v6h6' }),
    React.createElement('path', { d: 'M21 17a9 9 0 0 0-15-6.7L3 13' }),
  )
}

function SpinnerIcon() {
  return React.createElement(Icon, {
    title: '正在优化',
    style: { animation: 'dsh-prompt-optimizer-spin 1s linear infinite' },
  },
    React.createElement('path', { d: 'M21 12a9 9 0 1 1-6.2-8.6' }),
  )
}

/** Composer input snapshot a Session-scope slot occupant reads through `useInput`. */
interface ComposerInputSnapshot {
  /** Current unsent draft text. */
  draft: string
  /** Input lifecycle phase; only `plain` submits a whole-draft text prompt. */
  phase: string
}

function PromptOptimizerButton(props: any) {
  const { useInput, inputActions } = props
  const [state, setState] = useState<ButtonState>('idle')
  const [original, setOriginal] = useState('')
  // The composer's input machine reaches Session-scope slot occupants as the
  // standard prop `useInput`; `conversation.input.right` owner props are empty.
  const input: ComposerInputSnapshot | undefined = useInput((snapshot: ComposerInputSnapshot) => snapshot)
  const draft = input?.draft ?? ''
  const draftRef = useRef(draft)
  draftRef.current = draft
  const canOptimize = state === 'idle' && draft.trim() !== '' && input?.phase === 'plain'
  const canUndo = state === 'optimized' && original !== ''

  useEffect(() => {
    if (state !== 'idle' && draft.trim() === '') {
      setState('idle')
      setOriginal('')
    }
  }, [draft, state])

  async function handleClick() {
    if (state === 'loading') return
    if (state === 'optimized') {
      if (!canUndo) return
      inputActions.setDraft(original)
      setState('idle')
      setOriginal('')
      return
    }
    if (!canOptimize) return
    const prompt = draft
    setOriginal(prompt)
    setState('loading')
    try {
      const response = await fetch(API_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const data = await response.json()
      if (!response.ok || typeof data.optimized !== 'string' || data.optimized.trim() === '') {
        throw new Error(data.error ?? '优化失败')
      }
      if (draftRef.current !== prompt) {
        setState('idle')
        setOriginal('')
        return
      }
      inputActions.setDraft(data.optimized)
      setState('optimized')
    } catch (error) {
      console.error('prompt optimizer failed', error)
      setState('idle')
      setOriginal('')
    }
  }

  const disabled = state === 'loading' || (state === 'idle' && !canOptimize) || (state === 'optimized' && !canUndo)
  const label = state === 'optimized' ? '撤回优化' : '优化提示词'

  return React.createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-prompt-optimizer-button',
      title: label,
      'aria-label': label,
      disabled,
      onClick: handleClick,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        padding: 0,
        border: 'none',
        background: 'transparent',
        color: state === 'loading' ? 'var(--dsw-alias-label-tertiary, #999)' : 'var(--dsw-alias-label-secondary, #666)',
        cursor: disabled ? 'default' : 'pointer',
        borderRadius: 8,
        opacity: disabled ? 0.45 : 1,
      },
    },
    state === 'loading' ? React.createElement(SpinnerIcon) : state === 'optimized' ? React.createElement(UndoIcon) : React.createElement(OptimizeIcon),
  )
}

function NullDockEntry() {
  return null
}

/** Styles of the composer button and the settings section. */
const PAGE_STYLE = `
@keyframes dsh-prompt-optimizer-spin { to { transform: rotate(360deg) } }

.dspo { display: flex; flex-direction: column; gap: 18px; max-width: 720px; font-family: var(--dsw-font-family); }
.dspo-title { margin: 0; font-size: 18px; font-weight: 600; color: var(--dsw-alias-label-primary, #1a1a1a); }
.dspo-intro { margin: 0; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #666); }
.dspo-loading { margin: 0; font-size: 13px; color: var(--dsw-alias-label-secondary, #666); }
.dspo-error { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-state-error-primary, #d9480f); }
.dspo-group { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--dsw-alias-border-primary, #e5e5e5); border-radius: 10px; }
.dspo-group-head { display: flex; flex-direction: column; gap: 4px; }
.dspo-group-title { margin: 0; font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary, #1a1a1a); }
.dspo-group-desc { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary, #888); }
.dspo-field { display: flex; flex-direction: column; gap: 6px; }
.dspo-label { font-size: 13px; color: var(--dsw-alias-label-primary, #1a1a1a); }
.dspo-select { width: 100%; padding: 7px 10px; font: inherit; font-size: 13px; color: var(--dsw-alias-label-primary, #1a1a1a); background: var(--dsw-alias-bg-primary, #fff); border: 1px solid var(--dsw-alias-border-primary, #d9d9d9); border-radius: 8px; }
.dspo-select:disabled { opacity: 0.55; }
.dspo-segmented { display: flex; flex-wrap: wrap; gap: 6px; }
.dspo-seg { padding: 6px 12px; font: inherit; font-size: 13px; color: var(--dsw-alias-label-secondary, #666); background: transparent; border: 1px solid var(--dsw-alias-border-primary, #d9d9d9); border-radius: 999px; cursor: pointer; }
.dspo-seg.is-active { color: var(--dsw-alias-label-primary, #1a1a1a); background: var(--dsw-alias-bg-secondary, #f2f2f2); border-color: var(--dsw-alias-state-info-primary, #4a90d9); }
.dspo-seg:disabled { cursor: default; opacity: 0.55; }
.dspo-help { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #666); }
.dspo-levels { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.dspo-level { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary, #888); }
.dspo-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dspo-btn { padding: 7px 16px; font: inherit; font-size: 13px; color: var(--dsw-alias-label-primary, #1a1a1a); background: var(--dsw-alias-bg-secondary, #f2f2f2); border: 1px solid var(--dsw-alias-border-primary, #d9d9d9); border-radius: 8px; cursor: pointer; }
.dspo-btn.is-primary { color: #fff; background: var(--dsw-alias-state-info-primary, #4a90d9); border-color: transparent; }
.dspo-btn:disabled { cursor: default; opacity: 0.5; }
.dspo-toast { font-size: 12px; }
.dspo-toast.is-ok { color: var(--dsw-alias-state-success-primary, #2f9e44); }
.dspo-toast.is-bad { color: var(--dsw-alias-state-error-primary, #d9480f); }
`

export function apply(ctx: any): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = PAGE_STYLE
    document.head.appendChild(style)
    return () => { style.remove() }
  }, '@dsh-external/ui-prompt-optimizer: spinner keyframes')

  // The super-injector preflight only accepts a curated slot whitelist, so a
  // no-op dock entry keeps the bundle valid while the real control lives in
  // the composer tool row.
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register({
      name: 'conversation.input.dock',
      id: '@dsh-external/ui-prompt-optimizer-dock-placeholder',
      order: 100,
      priority: 0,
    }, NullDockEntry),
  )
  ctx.slots.inject('conversation.input.right', () =>
    ctx.slots.register({
      name: 'conversation.input.right',
      id: '@dsh-external/ui-prompt-optimizer-button',
      order: 100,
      priority: 0,
    }, PromptOptimizerButton),
  )

  // Settings → 提示词优化: the model and reasoning effort this plugin optimizes with.
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section',
      id: 'prompt-optimizer',
      order: 30,
      label: () => '提示词优化',
    }, PromptOptimizerSection),
  )
}
