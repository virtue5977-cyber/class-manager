import { afterEach, expect, test } from 'vitest'
import { readAppearance, saveAppearance } from './appearance'

afterEach(() => localStorage.clear())

test('저장한 화면 설정을 적용하고, 잘못된 값은 기본값으로 읽는다', () => {
  saveAppearance({ theme: 'dark', size: 'lg', accent: 'green' })
  expect(readAppearance()).toEqual({ theme: 'dark', size: 'lg', accent: 'green' })
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(document.documentElement.dataset.accent).toBe('green')
  expect(document.documentElement.style.getPropertyValue('--zoom')).toBe('1.1')
  localStorage.setItem('cm.appearance', '{"theme":"neon","size":"huge","accent":"red"}')
  expect(readAppearance()).toEqual({ theme: 'warm', size: 'md', accent: 'auto' })
  saveAppearance({ theme: 'warm', size: 'md', accent: 'auto' })
  expect(document.documentElement.dataset.theme).toBeUndefined()
  expect(document.documentElement.dataset.accent).toBeUndefined()
})
