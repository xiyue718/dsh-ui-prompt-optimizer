/**
 * @dsh-external/ui-prompt-optimizer — browser half.
 * Adds an icon-only button to the composer tool row. Clicking it replaces the
 * unsent draft with an optimized prompt; the same button becomes an undo
 * button that restores the original draft.
 */
import React, { useEffect, useRef, useState } from 'react'

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

function PromptOptimizerButton(props: any) {
  const { input, inputActions } = props
  const [state, setState] = useState<ButtonState>('idle')
  const [original, setOriginal] = useState('')
  const draft = input.draft
  const draftRef = useRef(draft)
  draftRef.current = draft
  const canOptimize = state === 'idle' && draft.trim() !== '' && input.phase === 'plain'
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

export function apply(ctx: any): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = '@keyframes dsh-prompt-optimizer-spin { to { transform: rotate(360deg) } }'
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
}
