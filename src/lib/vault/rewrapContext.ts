import { createContext } from 'react'
import type { DerivedPassKey } from '../backup/service'

/** 암호구를 바꿀 때 열쇠 파일의 pass 감싸기를 교체하는 함수(Task 9가 채운다). 없으면 null. */
export const VaultRewrapContext = createContext<((k: DerivedPassKey) => Promise<void>) | null>(null)
