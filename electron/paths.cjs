const path = require('node:path')

/** 자료 폴더: 옛 이름(담임업무) 폴더가 있으면 그대로 써서 Watson으로 바꿔도 자료가 이어지게 한다. */
function pickUserDataDir(appData, exists) {
  const legacy = path.join(appData, '담임업무')
  return exists(legacy) ? legacy : path.join(appData, 'Watson')
}

module.exports = { pickUserDataDir }
