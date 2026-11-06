export class BackupDecryptError extends Error {
  constructor() {
    super('암호구가 틀렸거나 백업 파일이 손상되었습니다.')
    this.name = 'BackupDecryptError'
  }
}

export class BackupFormatError extends Error {
  constructor() {
    super('백업 파일 형식이 올바르지 않습니다.')
    this.name = 'BackupFormatError'
  }
}

export class BackupVersionError extends Error {
  constructor() {
    super('이 백업은 더 새로운 버전의 앱에서 만들어졌습니다. 앱을 업데이트한 뒤 복원하세요.')
    this.name = 'BackupVersionError'
  }
}
